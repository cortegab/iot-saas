"""Integration tests for the G notification feed (severity/kind, dismiss and
restore, unread), the notifications that new events write (delivery failed,
template changed), and retrying a failed delivery — against the real FastAPI
app and iot_test Postgres, with a mocked MQTT client and stubbed email.
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications import service as notifications_service
from app.rules import executors
from app.rules import service as rules_service
from app.rules.models import ActionExecution
from app.tenants.models import Tenant


async def _register(client: httpx.AsyncClient, email: str, tenant_name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": tenant_name},
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


def _auth_headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def _workspace(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    owner = await _register(client, f"owner-{tag}@example.com", f"Feed {tag}")
    tenant_id = owner["memberships"][0]["tenant_id"]
    return _auth_headers(owner, tenant_id), tenant_id


async def _seed(
    factory: async_sessionmaker[AsyncSession], tenant_id: str, message: str, **kw: Any
) -> None:
    await notifications_service.create_notification(
        factory, uuid.UUID(tenant_id), None, None, message, **kw
    )


async def test_feed_carries_severity_kind_and_detail(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "f1")
    await _seed(
        app_session_factory,
        tenant_id,
        "bay3 went offline",
        severity="critical",
        kind="device_offline",
        detail="Its last will arrived.",
    )
    [n] = (await client.get("/notifications", headers=headers)).json()
    assert (n["severity"], n["kind"], n["detail"]) == (
        "critical",
        "device_offline",
        "Its last will arrived.",
    )
    assert n["dismissed_at"] is None


async def test_dismiss_hides_and_restore_brings_back(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "f2")
    await _seed(app_session_factory, tenant_id, "something")
    [n] = (await client.get("/notifications", headers=headers)).json()

    dismissed = await client.post(f"/notifications/{n['id']}/dismiss", headers=headers)
    assert dismissed.status_code == 200
    assert dismissed.json()["read_at"] is not None  # a dismissed row never counts as unread
    assert (await client.get("/notifications", headers=headers)).json() == []

    restored = await client.post(f"/notifications/{n['id']}/restore", headers=headers)
    assert restored.status_code == 200
    assert len((await client.get("/notifications", headers=headers)).json()) == 1


async def test_mark_unread(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "f3")
    await _seed(app_session_factory, tenant_id, "something")
    [n] = (await client.get("/notifications", headers=headers)).json()
    await client.patch(f"/notifications/{n['id']}/read", headers=headers)
    resp = await client.patch(f"/notifications/{n['id']}/unread", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["read_at"] is None


async def test_dismiss_is_tenant_scoped(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    _, tenant_a = await _workspace(client, "f4a")
    headers_b, _ = await _workspace(client, "f4b")
    await _seed(app_session_factory, tenant_a, "A's")
    async with app_session_factory() as s:
        from app.db import set_tenant_context
        from app.notifications.models import Notification

        await set_tenant_context(s, uuid.UUID(tenant_a))
        nid = (await s.execute(select(Notification.id))).scalar_one()
    resp = await client.post(f"/notifications/{nid}/dismiss", headers=headers_b)
    assert resp.status_code == 404


async def test_template_change_notifies_with_reach(client: httpx.AsyncClient) -> None:
    headers, _ = await _workspace(client, "f5")
    entry = (await client.get("/catalog", headers=headers)).json()[0]
    await client.post(
        "/devices", json={"name": "S1", "catalog_entry_id": entry["id"]}, headers=headers
    )
    metrics = [*entry["metrics"], {"key": "co2", "name": "CO2", "unit": "ppm"}]
    resp = await client.patch(f"/catalog/{entry['id']}", json={"metrics": metrics}, headers=headers)
    assert resp.status_code == 200, resp.text

    [n] = (await client.get("/notifications", headers=headers)).json()
    assert n["kind"] == "template_changed"
    assert n["severity"] == "info"
    assert n["catalog_entry_id"] == entry["id"]
    assert n["detail"] == "Changed 1 metric. 1 device received the new profile."


async def test_template_rename_does_not_notify(client: httpx.AsyncClient) -> None:
    headers, _ = await _workspace(client, "f6")
    entry = (await client.get("/catalog", headers=headers)).json()[0]
    await client.patch(f"/catalog/{entry['id']}", json={"name": "Renamed"}, headers=headers)
    assert (await client.get("/notifications", headers=headers)).json() == []


# ---- failed deliveries: notification + retry --------------------------------


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


class _FlakyEmail:
    def __init__(self) -> None:
        self.fail = True
        self.sent: list[Any] = []

    async def send(self, msg: Any) -> None:
        if self.fail:
            raise RuntimeError("550 Mailbox full")
        self.sent.append(msg)


@pytest.fixture
def flaky_email(monkeypatch: pytest.MonkeyPatch) -> _FlakyEmail:
    provider = _FlakyEmail()
    monkeypatch.setattr(executors, "get_email_provider", lambda: provider)
    return provider


async def _failed_email_delivery(
    client: httpx.AsyncClient,
    factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mqtt: AsyncMock,
    deferred_actions: Any,
    tag: str,
) -> tuple[dict[str, str], str]:
    headers, tenant_id = await _workspace(client, tag)
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    device = (
        await client.post(
            "/devices", json={"name": "S1", "catalog_entry_id": entry_id}, headers=headers
        )
    ).json()
    rule = await client.post(
        "/rules",
        json={
            "name": "Too hot",
            "condition": {
                "kind": "leaf",
                "device_id": device["device"]["id"],
                "metric": "temperature",
                "operator": ">",
                "rhs": {"source": "static", "value": 30.0},
            },
            "actions": [
                {"type": "email", "to": ["ops@example.com"], "subject": "Hot", "body": "Too hot"}
            ],
        },
        headers=headers,
    )
    assert rule.status_code == 201, rule.text
    slug = (
        await admin_session.execute(select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id)))
    ).scalar_one()
    await rules_service.load_rule_cache(factory)
    await rules_service.evaluate_and_dispatch(
        mqtt,
        factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device["device"]["id"]),
        slug,
        device["device"]["slug"],
        "temperature",
        35.0,
        datetime.now(UTC),
    )
    await deferred_actions.drain()
    return headers, tenant_id


async def test_failed_delivery_notifies_and_retry_succeeds(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    flaky_email: _FlakyEmail,
) -> None:
    headers, _ = await _failed_email_delivery(
        client, app_session_factory, admin_session, mock_mqtt_client, deferred_actions, "f7"
    )
    feed = (await client.get("/notifications", headers=headers)).json()
    failed_note = next(n for n in feed if n["kind"] == "delivery_failed")
    assert failed_note["message"] == 'Email delivery failed for "Too hot"'
    assert "Mailbox full" in failed_note["detail"]

    [failed] = (await client.get("/rules/failed-actions", headers=headers)).json()
    flaky_email.fail = False
    resp = await client.post(f"/rules/failed-actions/{failed['id']}/retry", headers=headers)
    assert resp.status_code == 202, resp.text
    await deferred_actions.drain()

    assert len(flaky_email.sent) == 1
    assert (await client.get("/rules/failed-actions", headers=headers)).json() == []
    rows = (
        (
            await admin_session.execute(
                select(ActionExecution).where(ActionExecution.action_type == "email")
            )
        )
        .scalars()
        .all()
    )
    assert sorted(r.status for r in rows) == ["failed", "success"]
    assert next(r for r in rows if r.status == "failed").retried_at is not None

    again = await client.post(f"/rules/failed-actions/{failed['id']}/retry", headers=headers)
    assert again.status_code == 409


async def test_failed_retry_shows_the_new_attempt(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    flaky_email: _FlakyEmail,
) -> None:
    headers, _ = await _failed_email_delivery(
        client, app_session_factory, admin_session, mock_mqtt_client, deferred_actions, "f8"
    )
    [failed] = (await client.get("/rules/failed-actions", headers=headers)).json()
    await client.post(f"/rules/failed-actions/{failed['id']}/retry", headers=headers)
    await deferred_actions.drain()
    [latest] = (await client.get("/rules/failed-actions", headers=headers)).json()
    assert latest["id"] != failed["id"]


async def test_retry_refuses_when_rule_changed(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    flaky_email: _FlakyEmail,
) -> None:
    headers, _ = await _failed_email_delivery(
        client, app_session_factory, admin_session, mock_mqtt_client, deferred_actions, "f9"
    )
    [failed] = (await client.get("/rules/failed-actions", headers=headers)).json()
    await client.patch(
        f"/rules/{failed['rule_id']}",
        json={"actions": [{"type": "notification", "message": "x", "channels": ["platform"]}]},
        headers=headers,
    )
    resp = await client.post(f"/rules/failed-actions/{failed['id']}/retry", headers=headers)
    assert resp.status_code == 409
    assert "rule changed" in resp.json()["detail"]


async def test_viewer_cannot_retry(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    flaky_email: _FlakyEmail,
) -> None:
    headers, tenant_id = await _failed_email_delivery(
        client, app_session_factory, admin_session, mock_mqtt_client, deferred_actions, "f10"
    )
    [failed] = (await client.get("/rules/failed-actions", headers=headers)).json()
    viewer = await _register(client, "viewer-f10@example.com", "Own f10")
    await client.post(
        "/tenants/members",
        json={"email": "viewer-f10@example.com", "role": "viewer"},
        headers=headers,
    )
    resp = await client.post(
        f"/rules/failed-actions/{failed['id']}/retry", headers=_auth_headers(viewer, tenant_id)
    )
    assert resp.status_code == 403
