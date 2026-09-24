"""Integration tests for the Phase 5 rule-health field on RuleResponse —
computed from device_metric_health + the catalog publish profile, per request,
under RLS. Real FastAPI app + iot_test Postgres.
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


async def _set_metric_health(
    admin_session: AsyncSession, tenant_id: str, device_id: str, metric: str, seen_at: datetime
) -> None:
    await admin_session.execute(
        text(
            "INSERT INTO device_metric_health "
            "  (id, tenant_id, device_id, metric, last_value, last_seen_at, updated_at) "
            "VALUES (:id, :tenant_id, :device_id, :metric, 25.0, :seen_at, now()) "
            "ON CONFLICT (device_id, metric) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at"
        ),
        {
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "device_id": device_id,
            "metric": metric,
            "seen_at": seen_at,
        },
    )
    await admin_session.commit()


async def test_health_missing_when_no_metric_health_row(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner-h1@example.com", "AcmeH1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = await _create_rule(client, headers, device["device"]["id"])

    rule = (await client.get(f"/rules/{rule_id}", headers=headers)).json()
    assert rule["health"]["evaluatable"] is False
    assert len(rule["health"]["signals"]) == 1
    sig = rule["health"]["signals"][0]
    assert sig["metric"] == "temperature"
    assert sig["state"] == "missing"
    assert sig["last_seen_at"] is None


async def test_health_fresh_then_stale(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-h2@example.com", "AcmeH2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    rule_id = await _create_rule(client, headers, device_id)

    await _set_metric_health(admin_session, tenant_id, device_id, "temperature", datetime.now(UTC))
    rule = (await client.get(f"/rules/{rule_id}", headers=headers)).json()
    assert rule["health"]["evaluatable"] is True
    assert rule["health"]["signals"][0]["state"] == "fresh"
    assert rule["health"]["signals"][0]["last_value"] == 25.0

    # push last_seen_at well past any derived max-age
    await _set_metric_health(
        admin_session,
        tenant_id,
        device_id,
        "temperature",
        datetime.now(UTC) - timedelta(hours=6),
    )
    rule = (await client.get(f"/rules/{rule_id}", headers=headers)).json()
    assert rule["health"]["evaluatable"] is False
    assert rule["health"]["signals"][0]["state"] == "stale"


async def test_health_appears_on_list_endpoint(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner-h3@example.com", "AcmeH3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    await _create_rule(client, headers, device["device"]["id"])
    await _set_metric_health(
        admin_session, tenant_id, device["device"]["id"], "temperature", datetime.now(UTC)
    )

    rules = (await client.get("/rules", headers=headers)).json()
    assert len(rules) == 1
    assert rules[0]["health"]["evaluatable"] is True


async def test_health_is_tenant_isolated(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner_a = await _register(client, "owner-h4a@example.com", "AcmeH4A")
    tid_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tid_a)
    device_a = await _create_device(client, headers_a)
    rule_a = await _create_rule(client, headers_a, device_a["device"]["id"])
    await _set_metric_health(
        admin_session, tid_a, device_a["device"]["id"], "temperature", datetime.now(UTC)
    )

    owner_b = await _register(client, "owner-h4b@example.com", "AcmeH4B")
    tid_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tid_b)

    # tenant B cannot see tenant A's rule at all
    assert (await client.get(f"/rules/{rule_a}", headers=headers_b)).status_code == 404
    # and tenant A still resolves its own health correctly
    rule = (await client.get(f"/rules/{rule_a}", headers=headers_a)).json()
    assert rule["health"]["signals"][0]["state"] == "fresh"
