"""Integration tests for the attention strip's counts
(GET /tenants/current/attention) — against the real FastAPI app and iot_test
Postgres, under RLS.
"""

import uuid
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications import service as notifications_service


async def _workspace(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    resp = await client.post(
        "/auth/register",
        json={
            "email": f"attn-{tag}@example.com",
            "password": "hunter2hunter2",
            "tenant_name": f"Attention {tag}",
        },
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    tenant_id: str = body["memberships"][0]["tenant_id"]
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}, tenant_id


async def _attention(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, int]:
    resp = await client.get("/tenants/current/attention", headers=headers)
    assert resp.status_code == 200, resp.text
    body: dict[str, int] = resp.json()
    return body


async def test_a_quiet_workspace_needs_nothing(client: httpx.AsyncClient) -> None:
    headers, _ = await _workspace(client, "a1")
    assert await _attention(client, headers) == {
        "critical_alerts": 0,
        "offline_devices": 0,
        "latched_rules": 0,
        "unhealthy_rules": 0,
    }


async def test_counts_critical_alerts_offline_devices_and_rules_that_cant_evaluate(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    headers, tenant_id = await _workspace(client, "a2")
    tid = uuid.UUID(tenant_id)
    # Two repeats of one critical alert count once; a warning and a read
    # critical don't count.
    for _ in range(2):
        await notifications_service.create_notification(
            app_session_factory, tid, None, None, "bay1 went offline", severity="critical"
        )
    await notifications_service.create_notification(
        app_session_factory, tid, None, None, "warm", severity="warning"
    )

    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    made = []
    for name in ("bay1", "bay2", "bay3"):
        resp = await client.post(
            "/devices", json={"name": name, "catalog_entry_id": entry}, headers=headers
        )
        made.append(resp.json()["device"]["id"])
    # bay1 went offline (its Last-Will), bay2 is online, bay3 never connected.
    await admin_session.execute(
        text("UPDATE devices SET last_status_online = (id = :on) WHERE id IN (:off, :on)"),
        {"off": uuid.UUID(made[0]), "on": uuid.UUID(made[1])},
    )
    await admin_session.commit()

    # A rule on a reading nobody publishes can't evaluate.
    rule = await client.post(
        f"/devices/{made[1]}/rules",
        json={
            "condition": {
                "kind": "leaf",
                "metric": "e2e-never-published",
                "operator": ">",
                "rhs": {"source": "static", "value": 1.0},
            },
            "action": {"type": "actuator_command", "actuator": "fan1", "value": True},
        },
        headers=headers,
    )
    assert rule.status_code == 201, rule.text

    assert await _attention(client, headers) == {
        "critical_alerts": 1,
        "offline_devices": 1,
        "latched_rules": 0,
        "unhealthy_rules": 1,
    }

    # Read alerts and a disabled rule stop counting.
    await client.post("/notifications/read", headers=headers)
    await client.patch(f"/rules/{rule.json()['id']}", json={"enabled": False}, headers=headers)
    counts = await _attention(client, headers)
    assert counts["critical_alerts"] == 0
    assert counts["unhealthy_rules"] == 0


async def test_counts_are_tenant_scoped(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    _, tenant_a = await _workspace(client, "a3")
    headers_b, _ = await _workspace(client, "a4")
    await notifications_service.create_notification(
        app_session_factory, uuid.UUID(tenant_a), None, None, "boom", severity="critical"
    )
    assert (await _attention(client, headers_b))["critical_alerts"] == 0
