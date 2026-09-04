"""Integration tests for Phase 2's device health: the Tier A status-message
write path (app.worker._handle_status), Tier B per-metric health
(app.health.service), the retained config-publish fan-out
(app.worker._handle_config_publish), and the catalog reserved-key guard —
against the real iot_test Postgres and a mocked aiomqtt.Client (no real
broker in tests, same approach test_commands.py uses).
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.db import set_tenant_context
from app.health import service as health_service
from app.ingestion.service import ParsedTopic


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


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


# ---- Tier A: _handle_status -------------------------------------------------


async def test_status_message_updates_tier_a_fields_and_connection_state(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "owner-health1@example.com", "AcmeHealth1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    parsed = ParsedTopic(
        tenant_slug=device["tenant_slug"], device_slug=device["device"]["slug"], metric="status"
    )
    payload = json.dumps(
        {"online": True, "rssi": -60, "battery_pct": 88, "uptime_s": 500, "fw_version": "1.0.0"}
    ).encode()

    await worker._handle_status(app_session_factory, parsed, payload)

    resp = await client.get(f"/devices/{device_id}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["connection_state"] == "online"
    assert body["rssi"] == -60
    assert body["battery_pct"] == 88
    assert body["uptime_s"] == 500
    assert body["fw_version"] == "1.0.0"


async def test_status_offline_is_authoritative_even_with_no_prior_telemetry(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """A brand-new device has last_seen_at=None (never_connected under the old
    heuristic alone) — an explicit `online: false` status/LWT message must
    still report "offline", not "never_connected": push-driven state wins.
    """
    owner = await _register(client, "owner-health2@example.com", "AcmeHealth2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    parsed = ParsedTopic(
        tenant_slug=device["tenant_slug"], device_slug=device["device"]["slug"], metric="status"
    )
    await worker._handle_status(app_session_factory, parsed, json.dumps({"online": False}).encode())

    resp = await client.get(f"/devices/{device_id}", headers=headers)
    assert resp.json()["connection_state"] == "offline"


async def test_malformed_status_payload_is_dropped_not_raised(
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    parsed = ParsedTopic(tenant_slug="doesnotmatter", device_slug="doesnotmatter", metric="status")
    await worker._handle_status(app_session_factory, parsed, b"not json")


async def test_status_for_unknown_device_is_dropped_not_raised(
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    parsed = ParsedTopic(tenant_slug="ghost-tenant", device_slug="ghost-device", metric="status")
    await worker._handle_status(app_session_factory, parsed, json.dumps({"online": True}).encode())


# ---- Tier B: health_service.record_batch / list_for_device -----------------


async def test_record_batch_and_list_for_device_round_trip(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "owner-health3@example.com", "AcmeHealth3")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])
    headers = _auth_headers(owner, str(tenant_id))
    device = await _create_device(client, headers)
    device_id = uuid.UUID(device["device"]["id"])

    async with app_session_factory() as session, session.begin():
        await health_service.record_batch(
            session, [(device_id, "temperature", 21.5)], datetime.now(UTC)
        )

    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        rows = await health_service.list_for_device(session, tenant_id, device_id)
    assert len(rows) == 1
    assert rows[0].metric == "temperature"
    assert rows[0].last_value == 21.5


async def test_record_batch_upsert_keeps_latest_value_per_metric(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "owner-health4@example.com", "AcmeHealth4")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])
    headers = _auth_headers(owner, str(tenant_id))
    device = await _create_device(client, headers)
    device_id = uuid.UUID(device["device"]["id"])

    async with app_session_factory() as session, session.begin():
        await health_service.record_batch(
            session, [(device_id, "temperature", 20.0)], datetime(2026, 1, 1, tzinfo=UTC)
        )
    async with app_session_factory() as session, session.begin():
        await health_service.record_batch(
            session, [(device_id, "temperature", 22.5)], datetime(2026, 1, 1, 0, 1, tzinfo=UTC)
        )

    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        rows = await health_service.list_for_device(session, tenant_id, device_id)
    assert len(rows) == 1
    assert rows[0].last_value == 22.5


# ---- Reserved metric keys ----------------------------------------------------


async def test_catalog_rejects_reserved_metric_key(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-health5@example.com", "AcmeHealth5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post(
        "/catalog",
        json={"name": "Bad Type", "metrics": [{"name": "Status", "key": "status"}]},
        headers=headers,
    )
    assert resp.status_code == 400


# ---- Config-publish fan-out --------------------------------------------------


async def test_config_publish_request_publishes_retained_message_per_device(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-health6@example.com", "AcmeHealth6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]

    updated = await client.patch(
        f"/catalog/{catalog_entry_id}",
        json={
            "metrics": [
                {
                    "name": "Temperature",
                    "key": "temperature",
                    "publish": "periodic",
                    "publish_interval_seconds": 30,
                }
            ]
        },
        headers=headers,
    )
    assert updated.status_code == 200

    device = await _create_device(client, headers)

    raw = json.dumps({"catalog_entry_id": catalog_entry_id})
    await worker._handle_config_publish(mock_mqtt_client, app_session_factory, raw)

    mock_mqtt_client.publish.assert_called_once()
    call = mock_mqtt_client.publish.call_args
    topic = call.args[0]
    assert topic == f"{device['tenant_slug']}/{device['device']['slug']}/config"
    assert call.kwargs.get("retain") is True
    published_payload = json.loads(call.args[1])
    assert published_payload["metrics"][0]["key"] == "temperature"
    assert published_payload["metrics"][0]["interval_seconds"] == 30


async def test_config_publish_malformed_request_is_dropped_not_raised(
    app_session_factory: async_sessionmaker[AsyncSession], mock_mqtt_client: AsyncMock
) -> None:
    await worker._handle_config_publish(mock_mqtt_client, app_session_factory, "not json")
    mock_mqtt_client.publish.assert_not_called()
