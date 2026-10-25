"""Paging for the history feeds (app/paging.py): limit / offset query
parameters, the total in X-Total-Count, defaults that keep the old caps, the
command timeline's server-side filters, and tenant isolation — against the
real FastAPI app and iot_test Postgres.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands.models import Command
from app.notifications import service as notifications_service
from app.rules.models import ActionExecution, RuleExecution


async def _workspace(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    resp = await client.post(
        "/auth/register",
        json={
            "email": f"owner-{tag}@example.com",
            "password": "hunter2hunter2",
            "tenant_name": f"Paging {tag}",
        },
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    tenant_id = body["memberships"][0]["tenant_id"]
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}, tenant_id


async def _device(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": "Pager", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    device_id: str = resp.json()["device"]["id"]
    return device_id


async def _rule(client: httpx.AsyncClient, headers: dict[str, str], device_id: str) -> str:
    resp = await client.post(
        f"/devices/{device_id}/rules",
        json={
            "condition": {
                "kind": "leaf",
                "metric": "temperature",
                "operator": ">",
                "rhs": {"source": "static", "value": 30.0},
            },
            "action": {"type": "notification", "message": "hot"},
        },
        headers=headers,
    )
    assert resp.status_code == 201
    rule_id: str = resp.json()["id"]
    return rule_id


async def _seed_commands(
    admin_session: AsyncSession, tenant_id: str, device_id: str, n: int
) -> list[uuid.UUID]:
    """n commands one second apart, newest last: every third acked, the rest
    split between still pending (ttl far ahead) and no response (expired)."""
    now = datetime.now(UTC)
    ids: list[uuid.UUID] = []
    for i in range(n):
        at = now - timedelta(seconds=n - i)
        acked = i % 3 == 0
        pending = not acked and i % 3 == 1
        c = Command(
            tenant_id=uuid.UUID(tenant_id),
            device_id=uuid.UUID(device_id),
            actuator="fan1" if i % 2 == 0 else "pump1",
            value=True,
            issued_at=at,
            ttl_seconds=3600 if pending else 1,
            published_at=at,
            acked_at=at if acked else None,
            latency_ms=1.0,
        )
        admin_session.add(c)
        ids.append(c.id)
    await admin_session.commit()
    return ids


async def test_commands_page_with_total_and_defaults(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id = await _workspace(client, "cmd")
    device_id = await _device(client, headers)
    await _seed_commands(admin_session, tenant_id, device_id, 120)

    # No parameters: the old cap of 100, with the full total in the header.
    resp = await client.get(f"/devices/{device_id}/commands", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 100
    assert resp.headers["x-total-count"] == "120"

    # Pages are contiguous: newest first, no row repeated or skipped.
    first = (
        await client.get(f"/devices/{device_id}/commands?limit=50&offset=0", headers=headers)
    ).json()
    second = (
        await client.get(f"/devices/{device_id}/commands?limit=50&offset=50", headers=headers)
    ).json()
    third = (
        await client.get(f"/devices/{device_id}/commands?limit=50&offset=100", headers=headers)
    ).json()
    seen = [c["id"] for c in first + second + third]
    assert len(seen) == 120 == len(set(seen))
    times = [c["published_at"] for c in first + second + third]
    assert times == sorted(times, reverse=True)
    assert len(third) == 20

    # Out-of-range limits are refused.
    assert (
        await client.get(f"/devices/{device_id}/commands?limit=0", headers=headers)
    ).status_code == 422
    assert (
        await client.get(f"/devices/{device_id}/commands?limit=501", headers=headers)
    ).status_code == 422
    assert (
        await client.get(f"/devices/{device_id}/commands?offset=-1", headers=headers)
    ).status_code == 422


async def test_commands_filter_on_the_server(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id = await _workspace(client, "cmdf")
    device_id = await _device(client, headers)
    await _seed_commands(admin_session, tenant_id, device_id, 30)

    async def total(query: str) -> int:
        resp = await client.get(f"/devices/{device_id}/commands?{query}", headers=headers)
        assert resp.status_code == 200
        return int(resp.headers["x-total-count"])

    confirmed, pending, no_response = (
        await total("status=confirmed"),
        await total("status=pending"),
        await total("status=no_response"),
    )
    assert (confirmed, pending, no_response) == (10, 10, 10)
    assert await total("actuator=fan1") == 15
    rows = (
        await client.get(
            f"/devices/{device_id}/commands?status=confirmed&actuator=fan1", headers=headers
        )
    ).json()
    assert rows and all(r["actuator"] == "fan1" and r["acked_at"] is not None for r in rows)
    assert (
        await client.get(f"/devices/{device_id}/commands?status=bogus", headers=headers)
    ).status_code == 422


async def test_another_tenant_cannot_page_into_the_feeds(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers_a, tenant_a = await _workspace(client, "iso-a")
    device_a = await _device(client, headers_a)
    await _seed_commands(admin_session, tenant_a, device_a, 5)
    headers_b, _ = await _workspace(client, "iso-b")

    # B can't reach A's device at all, paged or not.
    resp = await client.get(f"/devices/{device_a}/commands?limit=500&offset=0", headers=headers_b)
    assert resp.status_code == 404
    # And B's own feeds count none of A's rows.
    feed = await client.get("/notifications?limit=500", headers=headers_b)
    assert feed.headers["x-total-count"] == "0"


async def test_notifications_page_with_total(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "notif")
    for i in range(60):
        await notifications_service.create_notification(
            app_session_factory, uuid.UUID(tenant_id), None, None, f"n{i}"
        )

    resp = await client.get("/notifications", headers=headers)
    assert len(resp.json()) == 50  # the old cap
    assert resp.headers["x-total-count"] == "60"
    rest = (await client.get("/notifications?limit=50&offset=50", headers=headers)).json()
    assert len(rest) == 10
    ids = [n["id"] for n in resp.json() + rest]
    assert len(set(ids)) == 60


async def test_versions_executions_and_failed_deliveries_page(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id = await _workspace(client, "rules")
    device_id = await _device(client, headers)
    rule_id = await _rule(client, headers, device_id)

    # Versions: one per save.
    for i in range(4):
        assert (
            await client.patch(
                f"/rules/{rule_id}", json={"name": f"Rule v{i + 2}"}, headers=headers
            )
        ).status_code == 200
    resp = await client.get(f"/rules/{rule_id}/versions?limit=2&offset=0", headers=headers)
    total_versions = int(resp.headers["x-total-count"])
    assert total_versions >= 5
    assert [v["version"] for v in resp.json()] == [total_versions, total_versions - 1]
    last = (
        await client.get(
            f"/rules/{rule_id}/versions?limit=2&offset={total_versions - 1}", headers=headers
        )
    ).json()
    assert [v["version"] for v in last] == [1]

    # Executions and failed deliveries: seeded rows, newest first.
    now = datetime.now(UTC)
    for i in range(7):
        execution = RuleExecution(
            tenant_id=uuid.UUID(tenant_id),
            rule_id=uuid.UUID(rule_id),
            device_id=uuid.UUID(device_id),
            fired_at=now - timedelta(minutes=7 - i),
            summary=f"fired {i}",
        )
        admin_session.add(execution)
        await admin_session.flush()
        admin_session.add(
            ActionExecution(
                tenant_id=uuid.UUID(tenant_id),
                rule_execution_id=execution.id,
                action_type="webhook",
                action_index=0,
                status="failed",
                detail={"error": "timeout"},
            )
        )
    await admin_session.commit()

    executions = await client.get(f"/rules/{rule_id}/executions?limit=3&offset=3", headers=headers)
    assert executions.headers["x-total-count"] == "7"
    assert [e["summary"] for e in executions.json()] == ["fired 3", "fired 2", "fired 1"]

    failed = await client.get("/rules/failed-actions?limit=5", headers=headers)
    assert failed.headers["x-total-count"] == "7"
    assert len(failed.json()) == 5
    rest = (await client.get("/rules/failed-actions?limit=5&offset=5", headers=headers)).json()
    assert len(rest) == 2
    assert {f["id"] for f in failed.json()}.isdisjoint({f["id"] for f in rest})
