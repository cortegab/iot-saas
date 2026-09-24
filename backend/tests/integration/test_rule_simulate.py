"""Integration tests for POST /rules/{id}/simulate — the dry-run endpoint.
Must evaluate correctly and write absolutely nothing. Real FastAPI app +
iot_test Postgres.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


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


async def _create_device(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _create_rule(client: httpx.AsyncClient, headers: dict[str, str], device_id: str) -> str:
    body = {
        "condition": {
            "kind": "leaf",
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": 30.0},
        },
        "action": {"type": "actuator_command", "actuator": "fan1", "value": True},
    }
    resp = await client.post(f"/devices/{device_id}/rules", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _seed_health(
    admin_session: AsyncSession,
    tenant_id: str,
    device_id: str,
    metric: str,
    value: float,
    seen_at: datetime,
) -> None:
    await admin_session.execute(
        text(
            "INSERT INTO device_metric_health "
            "  (id, tenant_id, device_id, metric, last_value, last_seen_at, updated_at) "
            "VALUES (:id, :tenant_id, :device_id, :metric, :value, :seen_at, now()) "
            "ON CONFLICT (device_id, metric) DO UPDATE "
            "  SET last_value = EXCLUDED.last_value, last_seen_at = EXCLUDED.last_seen_at"
        ),
        {
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "device_id": device_id,
            "metric": metric,
            "value": value,
            "seen_at": seen_at,
        },
    )
    await admin_session.commit()


async def _counts(admin_session: AsyncSession) -> tuple[int, int, int]:
    async def _n(table: str) -> int:
        result = await admin_session.execute(text(f"SELECT count(*) FROM {table}"))
        return int(result.scalar_one())

    return await _n("rule_executions"), await _n("commands"), await _n("notifications")


async def test_simulate_live_would_fire_and_writes_nothing(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-s1@example.com", "AcmeS1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = await _create_rule(client, headers, device["device"]["id"])
    await _seed_health(
        admin_session, tenant_id, device["device"]["id"], "temperature", 35.0, datetime.now(UTC)
    )

    before = await _counts(admin_session)
    resp = await client.post(f"/rules/{rule_id}/simulate", json={}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "live"
    assert body["would_fire"] is True
    assert body["condition"]["result"] is True
    assert body["condition"]["observed_value"] == 35.0
    assert body["unavailable_signals"] == []
    assert body["actions"][0]["type"] == "actuator_command"

    assert await _counts(admin_session) == before  # nothing written


async def test_simulate_reports_unavailable_signal(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-s2@example.com", "AcmeS2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = await _create_rule(client, headers, device["device"]["id"])
    # no device_metric_health row at all

    body = (await client.post(f"/rules/{rule_id}/simulate", json={}, headers=headers)).json()
    assert body["would_fire"] is False
    assert body["condition"]["signal_state"] == "missing"
    assert len(body["unavailable_signals"]) == 1


async def test_simulate_override_flips_result(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-s3@example.com", "AcmeS3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    rule_id = await _create_rule(client, headers, device_id)
    await _seed_health(admin_session, tenant_id, device_id, "temperature", 10.0, datetime.now(UTC))

    base = (await client.post(f"/rules/{rule_id}/simulate", json={}, headers=headers)).json()
    assert base["would_fire"] is False

    overridden = (
        await client.post(
            f"/rules/{rule_id}/simulate",
            json={"overrides": [{"device_id": device_id, "metric": "temperature", "value": 45.0}]},
            headers=headers,
        )
    ).json()
    assert overridden["would_fire"] is True


async def test_simulate_allowed_for_viewer_and_404_for_unknown(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner-s4@example.com", "AcmeS4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = await _create_rule(client, headers, device["device"]["id"])

    viewer = await _register(client, "viewer-s4@example.com", "ViewerHomeS4")
    await client.post(
        "/tenants/members",
        json={"email": "viewer-s4@example.com", "role": "viewer"},
        headers=headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    assert (
        await client.post(f"/rules/{rule_id}/simulate", json={}, headers=viewer_headers)
    ).status_code == 200
    assert (
        await client.post(f"/rules/{uuid.uuid4()}/simulate", json={}, headers=headers)
    ).status_code == 404


async def test_simulate_replay_over_history(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-s5@example.com", "AcmeS5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    rule_id = await _create_rule(client, headers, device_id)

    base = datetime.now(UTC) - timedelta(hours=2)
    for i, value in enumerate((20.0, 40.0, 20.0, 45.0)):
        await admin_session.execute(
            text(
                "INSERT INTO telemetry (time, tenant_id, device_id, metric, value) "
                "VALUES (:t, :tenant_id, :device_id, 'temperature', :v)"
            ),
            {
                "t": base + timedelta(minutes=i * 10),
                "tenant_id": tenant_id,
                "device_id": device_id,
                "v": value,
            },
        )
    await admin_session.commit()

    resp = await client.post(
        f"/rules/{rule_id}/simulate",
        json={"replay": {"from": base.isoformat(), "to": datetime.now(UTC).isoformat()}},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "replay"
    assert body["replay"]["resolution"] == "raw"
    assert len(body["replay"]["would_have_fired_at"]) == 2  # the 40.0 and 45.0 crossings
    assert body["would_fire"] is True

    bad = await client.post(
        f"/rules/{rule_id}/simulate",
        json={"replay": {"from": datetime.now(UTC).isoformat(), "to": base.isoformat()}},
        headers=headers,
    )
    assert bad.status_code == 422
