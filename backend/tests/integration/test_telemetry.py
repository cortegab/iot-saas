"""Integration tests for the telemetry query API — against the real FastAPI
app and iot_test Postgres. Telemetry rows are inserted directly (the worker
that would normally write them isn't running in tests) via admin_session,
mirroring app/worker.py's own INSERT.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.telemetry.service import VALID_RESOLUTIONS


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


async def _create_device(
    client: httpx.AsyncClient, headers: dict[str, str], name: str = "Sensor 1"
) -> dict[str, Any]:
    resp = await client.post("/devices", json={"name": name}, headers=headers)
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _insert_telemetry(
    admin_session: AsyncSession,
    tenant_id: str,
    device_id: str,
    metric: str,
    value: float,
    time: datetime,
) -> None:
    await admin_session.execute(
        text(
            "INSERT INTO telemetry (time, tenant_id, device_id, metric, value) "
            "VALUES (:time, :tenant_id, :device_id, :metric, :value)"
        ),
        {
            "time": time,
            "tenant_id": uuid.UUID(tenant_id),
            "device_id": uuid.UUID(device_id),
            "metric": metric,
            "value": value,
        },
    )
    await admin_session.commit()


async def test_latest_returns_most_recent_per_metric(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    now = datetime.now(UTC)

    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 20.0, now - timedelta(minutes=5))
    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 21.5, now)
    await _insert_telemetry(admin_session, tenant_id, device_id, "humidity", 55.0, now)

    resp = await client.get(f"/devices/{device_id}/latest", headers=headers)
    assert resp.status_code == 200
    by_metric = {row["metric"]: row["value"] for row in resp.json()}
    assert by_metric == {"temperature": 21.5, "humidity": 55.0}


async def test_data_raw_resolution_returns_points_in_range(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    now = datetime.now(UTC)

    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 19.0, now - timedelta(hours=2))
    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 20.0, now - timedelta(minutes=10))
    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 21.0, now)

    resp = await client.get(
        f"/devices/{device_id}/data",
        params={
            "metric": "temperature",
            "from": (now - timedelta(hours=1)).isoformat(),
            "to": (now + timedelta(minutes=1)).isoformat(),
            "resolution": "raw",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["metric"] == "temperature"
    assert [p["value"] for p in body["points"]] == [20.0, 21.0]


async def test_data_invalid_resolution_rejected(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    resp = await client.get(
        f"/devices/{device_id}/data",
        params={"metric": "temperature", "from": datetime.now(UTC).isoformat(), "resolution": "5m"},
        headers=headers,
    )
    assert resp.status_code == 400


async def test_cross_tenant_device_404(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner4@example.com", "Acme4")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device = await _create_device(client, headers_a)
    device_id = device["device"]["id"]

    owner_b = await _register(client, "owner5@example.com", "Acme5")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get(f"/devices/{device_id}/latest", headers=headers_b)
    assert resp.status_code == 404


async def test_rollup_reflects_raw_data(
    client: httpx.AsyncClient, admin_session: AsyncSession, admin_engine: AsyncEngine
) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    bucket_start = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(minutes=10)
    await _insert_telemetry(admin_session, tenant_id, device_id, "temperature", 10.0, bucket_start)
    await _insert_telemetry(
        admin_session, tenant_id, device_id, "temperature", 20.0, bucket_start + timedelta(seconds=30)
    )

    # Continuous aggregate refresh can't run inside an ORM-managed transaction
    # (it manages its own) — a dedicated autocommit connection, same as a
    # scheduled refresh job would use.
    async with admin_engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(
            # Explicit casts: asyncpg can't infer parameter types for CALL's
            # extended-query protocol the way it can for SELECT/INSERT.
            text(
                "CALL refresh_continuous_aggregate("
                "'telemetry_1m', CAST(:start AS timestamptz), CAST(:end AS timestamptz))"
            ),
            {"start": bucket_start - timedelta(minutes=1), "end": bucket_start + timedelta(minutes=1)},
        )

    resp = await client.get(
        f"/devices/{device_id}/data",
        params={
            "metric": "temperature",
            "from": (bucket_start - timedelta(minutes=1)).isoformat(),
            "to": (bucket_start + timedelta(minutes=1)).isoformat(),
            "resolution": "1m",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    points = resp.json()["points"]
    assert len(points) == 1
    assert points[0]["value"] == 15.0


def test_valid_resolutions_are_raw_1m_1h() -> None:
    assert VALID_RESOLUTIONS == {"raw", "1m", "1h"}
