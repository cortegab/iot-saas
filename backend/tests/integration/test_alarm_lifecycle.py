"""The alarm lifecycle (DESIGN.md §13): Active -> Acknowledged (who, when, a
note; owners and admins) -> Cleared (the condition went away on its own).
Reading an alert no longer takes it out of "needs attention"."""

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.ingestion.service import ParsedTopic
from app.notifications import service as notifications_service
from app.rules import service as rules_service


async def _register(client: httpx.AsyncClient, email: str, name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register", json={"email": email, "password": "hunter2hunter2", "tenant_name": name}
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    return body


def _headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def _critical_group(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    groups = (
        await client.get("/notifications/groups", params={"severity": "critical"}, headers=headers)
    ).json()
    assert len(groups) == 1
    group: dict[str, Any] = groups[0]
    return group


async def test_acknowledging_records_who_and_the_note(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "alarm1@example.com", "Alarm1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _headers(owner, tenant_id)
    me = (await client.get("/auth/me", headers=headers)).json()
    for _ in range(2):
        await notifications_service.create_notification(
            app_session_factory,
            uuid.UUID(tenant_id),
            None,
            None,
            "pump stopped",
            severity="critical",
        )

    group = await _critical_group(client, headers)
    resp = await client.post(
        f"/notifications/groups/{group['key']}/acknowledge",
        json={"note": "  Ana is on site  "},
        headers=headers,
    )
    assert resp.status_code == 204

    latest = (await _critical_group(client, headers))["latest"]
    assert latest["acknowledged_at"] is not None
    assert latest["acknowledged_by"] == me["id"]
    assert latest["acknowledged_note"] == "Ana is on site"
    assert latest["read_at"] is not None
    # Every repeat is acknowledged: nothing left.
    again = await client.post(
        f"/notifications/groups/{group['key']}/acknowledge", json={}, headers=headers
    )
    assert again.status_code == 404
    active = (
        await client.get("/notifications/groups", params={"active": True}, headers=headers)
    ).json()
    assert active == []


async def test_viewers_can_read_but_not_acknowledge_or_dismiss(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "alarm2@example.com", "Alarm2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _headers(owner, tenant_id)
    viewer = await _register(client, "alarm2v@example.com", "Alarm2V")
    await client.post(
        "/tenants/members",
        json={"email": "alarm2v@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _headers(viewer, tenant_id)
    await notifications_service.create_notification(
        app_session_factory, uuid.UUID(tenant_id), None, None, "tank low", severity="critical"
    )
    group = await _critical_group(client, viewer_headers)

    read = await client.post(f"/notifications/groups/{group['key']}/read", headers=viewer_headers)
    assert read.status_code == 204
    ack = await client.post(
        f"/notifications/groups/{group['key']}/acknowledge", json={}, headers=viewer_headers
    )
    assert ack.status_code == 403
    dismiss = await client.post(
        f"/notifications/groups/{group['key']}/dismiss", headers=viewer_headers
    )
    assert dismiss.status_code == 403
    # The viewer read it; it still needs attention for everyone.
    attention = (await client.get("/tenants/current/attention", headers=owner_headers)).json()
    assert attention["critical_alerts"] == 1


async def test_back_online_clears_the_offline_alarm(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    owner = await _register(client, "alarm3@example.com", "Alarm3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _headers(owner, tenant_id)
    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    created = (
        await client.post(
            "/devices", json={"name": "bay1", "catalog_entry_id": entry}, headers=headers
        )
    ).json()
    parsed = ParsedTopic(
        tenant_slug=created["tenant_slug"], device_slug=created["device"]["slug"], metric="status"
    )

    async def status(online: bool) -> None:
        await worker._handle_status(
            app_session_factory, AsyncMock(), parsed, json.dumps({"online": online}).encode()
        )

    await status(True)
    await status(False)  # a real flip: the offline alarm
    assert (await client.get("/tenants/current/attention", headers=headers)).json()[
        "critical_alerts"
    ] == 1
    await status(True)

    row = await admin_session.execute(
        text("SELECT cleared_at FROM notifications WHERE kind = 'device_offline'")
    )
    assert row.scalar_one() is not None
    assert (await client.get("/tenants/current/attention", headers=headers)).json()[
        "critical_alerts"
    ] == 0


async def test_clear_alarms_is_scoped_to_its_rule(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "alarm4@example.com", "Alarm4")
    tid = uuid.UUID(owner["memberships"][0]["tenant_id"])
    rule_a, rule_b = uuid.uuid4(), uuid.uuid4()
    async with app_session_factory() as session, session.begin():
        from app.db import set_tenant_context

        await set_tenant_context(session, tid)
        await session.execute(
            text(
                "INSERT INTO rules (id, tenant_id, name, type, trigger, condition, "
                "execution_policy, actions, enabled) VALUES "
                "(:a, :t, 'A', 'threshold', '{}', NULL, '{}', '[]', true), "
                "(:b, :t, 'B', 'threshold', '{}', NULL, '{}', '[]', true)"
            ),
            {"a": rule_a, "b": rule_b, "t": tid},
        )
    for rule in (rule_a, rule_b):
        await notifications_service.create_notification(
            app_session_factory, tid, None, rule, "fired", kind="rule_fired"
        )

    cleared = await notifications_service.clear_alarms(
        app_session_factory, tid, kind="rule_fired", rule_id=rule_a
    )

    assert cleared == 1
    assert rules_service is not None
