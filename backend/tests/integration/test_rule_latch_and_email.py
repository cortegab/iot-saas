"""Integration tests for the simplified rule model's engine additions — the
"latch" strategy + POST /rules/{id}/reset, condition-less schedule/manual
rules, and the standalone `email` action.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.rules import executors
from app.rules import service as rules_service
from app.rules.models import ActionExecution, RuleExecution
from app.tenants.models import Tenant


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


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(
        select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id))
    )
    return result.scalar_one()


def _leaf(device_id: str, threshold: float = 30.0) -> dict[str, Any]:
    return {
        "kind": "leaf",
        "device_id": device_id,
        "metric": "temperature",
        "operator": ">",
        "rhs": {"source": "static", "value": threshold},
    }


def _fan_on(device_id: str) -> dict[str, Any]:
    return {"type": "actuator_command", "device_id": device_id, "actuator": "fan1", "value": True}


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def email_sink(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    sent: list[Any] = []

    class _Provider:
        async def send(self, msg: Any) -> None:
            sent.append(msg)

    monkeypatch.setattr(executors, "get_email_provider", lambda: _Provider())
    return sent


async def _reading(
    mqtt: AsyncMock,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: str,
    tenant_slug: str,
    device: dict[str, Any],
    value: float,
) -> None:
    await rules_service.evaluate_and_dispatch(
        mqtt,
        factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device["device"]["id"]),
        tenant_slug,
        device["device"]["slug"],
        "temperature",
        value,
        datetime.now(UTC),
    )


async def _executions(admin_session: AsyncSession) -> list[RuleExecution]:
    result = await admin_session.execute(select(RuleExecution).order_by(RuleExecution.fired_at))
    return list(result.scalars().all())


# ---- Latch ---------------------------------------------------------------


async def test_latch_rule_fires_once_until_reset(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    _mock_redis_publish: AsyncMock,
) -> None:
    owner = await _register(client, "owner-l1@example.com", "AcmeL1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    resp = await client.post(
        "/rules",
        json={
            "name": "Overheat alarm",
            "condition": _leaf(device_id),
            "execution_policy": {"strategy": "latch"},
            "actions": [_fan_on(device_id)],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    rule_id = resp.json()["id"]
    assert resp.json()["latched"] is False
    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    async def reading(value: float) -> None:
        await _reading(mock_mqtt_client, app_session_factory, tenant_id, tenant_slug, device, value)

    await reading(35.0)  # fires + latches
    await reading(10.0)  # false — an edge rule would re-arm here
    await reading(35.0)  # still latched
    assert len(await _executions(admin_session)) == 1
    assert (await client.get(f"/rules/{rule_id}", headers=headers)).json()["latched"] is True
    assert (await client.get("/rules", headers=headers)).json()[0]["latched"] is True

    # POST /reset publishes to the worker; drive the worker handler directly.
    assert (await client.post(f"/rules/{rule_id}/reset", headers=headers)).status_code == 202
    published = json.loads(_mock_redis_publish.call_args_list[-1].args[1])
    assert published == {"tenant_id": tenant_id, "rule_id": rule_id, "trigger_source": "reset"}
    await worker._handle_rule_trigger(
        mock_mqtt_client, app_session_factory, _mock_redis_publish.call_args_list[-1].args[1]
    )
    assert (await client.get(f"/rules/{rule_id}", headers=headers)).json()["latched"] is False

    await reading(35.0)  # armed again -> fires
    assert len(await _executions(admin_session)) == 2


async def test_reset_rejects_non_latch_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-l2@example.com", "AcmeL2")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    device_id = (await _create_device(client, headers))["device"]["id"]
    resp = await client.post(
        "/rules",
        json={"name": "Edge", "condition": _leaf(device_id), "actions": [_fan_on(device_id)]},
        headers=headers,
    )
    assert (
        await client.post(f"/rules/{resp.json()['id']}/reset", headers=headers)
    ).status_code == 422


async def test_latch_rejects_event_trigger_and_clear_actions(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-l3@example.com", "AcmeL3")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    device_id = (await _create_device(client, headers))["device"]["id"]
    base = {
        "name": "Latch",
        "condition": _leaf(device_id),
        "execution_policy": {"strategy": "latch"},
        "actions": [_fan_on(device_id)],
    }
    scheduled = {**base, "trigger": {"type": "schedule", "cron": "0 8 * * *"}}
    assert (await client.post("/rules", json=scheduled, headers=headers)).status_code == 422
    with_clear = {**base, "clear_actions": [{**_fan_on(device_id), "value": False}]}
    assert (await client.post("/rules", json=with_clear, headers=headers)).status_code == 422


# ---- Condition-less event / manual rules -------------------------------


async def test_condition_optional_except_for_metric_trigger(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-c1@example.com", "AcmeC1")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    device_id = (await _create_device(client, headers))["device"]["id"]
    for trigger in ({"type": "schedule", "cron": "0 8 * * *"}, {"type": "manual"}):
        resp = await client.post(
            "/rules",
            json={"name": "No condition", "trigger": trigger, "actions": [_fan_on(device_id)]},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["condition"] is None
    metric = {"name": "No condition", "actions": [_fan_on(device_id)]}
    assert (await client.post("/rules", json=metric, headers=headers)).status_code == 422


async def test_condition_less_schedule_fires_every_tick(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-c2@example.com", "AcmeC2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device_id = (await _create_device(client, headers))["device"]["id"]
    resp = await client.post(
        "/rules",
        json={
            "name": "Morning pump",
            "trigger": {"type": "schedule", "cron": "0 8 * * *"},
            # A stored hold (the old form default) must not swallow a tick.
            "execution_policy": {"for_duration": 10},
            "actions": [_fan_on(device_id)],
        },
        headers=headers,
    )
    rule_id = uuid.UUID(resp.json()["id"])
    await rules_service.load_rule_cache(app_session_factory)

    for _ in range(2):
        await rules_service.run_rule_out_of_band(
            mock_mqtt_client, app_session_factory, uuid.UUID(tenant_id), rule_id, "schedule"
        )
    executions = await _executions(admin_session)
    assert len(executions) == 2
    # The actuator action's own device stands in as the triggering device.
    assert executions[0].device_id == uuid.UUID(device_id)
    assert mock_mqtt_client.publish.await_count >= 2


# ---- Email action -------------------------------------------------------


async def test_email_action_sends_to_explicit_recipients(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    owner = await _register(client, "owner-e1@example.com", "AcmeE1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    resp = await client.post(
        "/rules",
        json={
            "name": "Mail ops",
            "condition": _leaf(device["device"]["id"]),
            "actions": [
                {
                    "type": "email",
                    "to": ["ops@example.com"],
                    "subject": "Too hot",
                    "body": "Boiler above 30",
                }
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await _reading(mock_mqtt_client, app_session_factory, tenant_id, tenant_slug, device, 35.0)
    await deferred_actions.drain()

    assert len(email_sink) == 1
    assert email_sink[0].to == ["ops@example.com"]
    assert email_sink[0].subject == "Too hot"
    row = (
        await admin_session.execute(
            select(ActionExecution).where(ActionExecution.action_type == "email")
        )
    ).scalar_one()
    assert row.status == "success"


async def test_condition_less_schedule_email_only_falls_back_to_tenant_list(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    # No condition and no actuator — the run has no device at all.
    owner = await _register(client, "owner-e2@example.com", "AcmeE2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    resp = await client.post(
        "/rules",
        json={
            "name": "Daily digest",
            "trigger": {"type": "schedule", "cron": "0 8 * * *"},
            "actions": [{"type": "email", "subject": "Good morning", "body": "All systems go"}],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    await rules_service.load_rule_cache(app_session_factory)

    await rules_service.run_rule_out_of_band(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(resp.json()["id"]),
        "schedule",
    )
    await deferred_actions.drain()

    execution = (await _executions(admin_session))[0]
    assert execution.device_id is None
    assert email_sink[0].to == ["owner-e2@example.com"]


async def test_email_action_rejects_malformed_address(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-e3@example.com", "AcmeE3")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    resp = await client.post(
        "/rules",
        json={
            "name": "Bad",
            "trigger": {"type": "manual"},
            "actions": [{"type": "email", "to": ["not-an-email"], "subject": "x", "body": "y"}],
        },
        headers=headers,
    )
    assert resp.status_code == 422
