"""Integration tests for the Phase 6 device_status trigger — connectivity
transition detection (worker._handle_status -> rules_service.note_device_status)
and the out-of-band dispatch it feeds (rules_service.run_device_status_rules).
"""

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.ingestion.service import ParsedTopic
from app.rules import service as rules_service
from app.rules.models import RuleExecution


async def _register(client: httpx.AsyncClient, email: str, tenant_name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": tenant_name},
    )
    assert resp.status_code == 201
    return resp.json()  # type: ignore[no-any-return]


def _auth_headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def _create_device(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    return resp.json()  # type: ignore[no-any-return]


def _device_status_rule_body(
    device_id: str,
    transition: str,
    *,
    condition: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "name": "Device status rule",
        "trigger": {"type": "device_status", "device_id": device_id, "transition": transition},
        "condition": condition,
        "actions": [{"type": "notification", "message": "device status changed"}],
    }


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


async def _send_status(
    factory: async_sessionmaker[AsyncSession],
    mqtt: AsyncMock,
    device: dict[str, Any],
    *,
    online: bool,
) -> None:
    parsed = ParsedTopic(
        tenant_slug=device["tenant_slug"], device_slug=device["device"]["slug"], metric="status"
    )
    await worker._handle_status(factory, mqtt, parsed, json.dumps({"online": online}).encode())


async def test_connect_fires_connected_rule_not_disconnected_rule(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-ds1@example.com", "AcmeDS1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    connected_rule = await client.post(
        "/rules", json=_device_status_rule_body(device_id, "connected"), headers=headers
    )
    disconnected_rule = await client.post(
        "/rules", json=_device_status_rule_body(device_id, "disconnected"), headers=headers
    )
    assert connected_rule.status_code == 201 and disconnected_rule.status_code == 201
    await rules_service.load_rule_cache(app_session_factory)

    # First observation after "restart" just establishes the baseline — no fire.
    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)
    assert (await admin_session.execute(select(RuleExecution))).scalars().all() == []

    # A flip to offline fires only the "disconnected" rule.
    await _send_status(app_session_factory, mock_mqtt_client, device, online=False)
    executions = (
        (await admin_session.execute(select(RuleExecution).order_by(RuleExecution.fired_at)))
        .scalars()
        .all()
    )
    assert [e.rule_id for e in executions] == [uuid.UUID(disconnected_rule.json()["id"])]
    assert executions[0].trigger_source == "device_status"

    # And a flip back to online fires only the "connected" rule.
    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)
    executions = (
        (await admin_session.execute(select(RuleExecution).order_by(RuleExecution.fired_at)))
        .scalars()
        .all()
    )
    assert [e.rule_id for e in executions] == [
        uuid.UUID(disconnected_rule.json()["id"]),
        uuid.UUID(connected_rule.json()["id"]),
    ]


async def test_disconnect_fires_disconnected_rule(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-ds2@example.com", "AcmeDS2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    resp = await client.post(
        "/rules", json=_device_status_rule_body(device_id, "disconnected"), headers=headers
    )
    assert resp.status_code == 201
    rule_id = uuid.UUID(resp.json()["id"])
    await rules_service.load_rule_cache(app_session_factory)

    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)  # baseline
    await _send_status(app_session_factory, mock_mqtt_client, device, online=False)  # flip

    executions = (await admin_session.execute(select(RuleExecution))).scalars().all()
    assert [e.rule_id for e in executions] == [rule_id]


async def test_condition_less_rule_fires_unconditionally_on_matching_transition(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-ds3@example.com", "AcmeDS3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    resp = await client.post(
        "/rules",
        json=_device_status_rule_body(device_id, "connected", condition=None),
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["condition"] is None
    await rules_service.load_rule_cache(app_session_factory)

    await _send_status(app_session_factory, mock_mqtt_client, device, online=False)  # baseline
    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)  # flip

    executions = (await admin_session.execute(select(RuleExecution))).scalars().all()
    assert len(executions) == 1


async def test_repeated_same_state_does_not_refire(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-ds4@example.com", "AcmeDS4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    await client.post(
        "/rules", json=_device_status_rule_body(device_id, "connected"), headers=headers
    )
    await rules_service.load_rule_cache(app_session_factory)

    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)  # baseline
    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)  # same state
    await _send_status(app_session_factory, mock_mqtt_client, device, online=True)  # same state

    assert (await admin_session.execute(select(RuleExecution))).scalars().all() == []


async def test_cross_tenant_device_id_rejected(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner-ds5a@example.com", "AcmeDS5A")
    headers_a = _auth_headers(owner_a, owner_a["memberships"][0]["tenant_id"])
    device_a = await _create_device(client, headers_a)

    owner_b = await _register(client, "owner-ds5b@example.com", "AcmeDS5B")
    headers_b = _auth_headers(owner_b, owner_b["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/rules",
        json=_device_status_rule_body(device_a["device"]["id"], "connected"),
        headers=headers_b,
    )
    assert resp.status_code == 422
