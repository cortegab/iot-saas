"""Integration tests for Phase 4 scheduled + manual triggers — the
load_rule_cache trigger split, the schedule tick, POST /rules/{id}/run, and
the shared out-of-band run path.
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
from app.rules import service as rules_service
from app.rules.evaluators import SignalKey
from app.rules.models import RuleExecution
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


def _rule_body(
    device_id: str, trigger: dict[str, Any], *, threshold: float = 30.0
) -> dict[str, Any]:
    return {
        "name": "Trigger rule",
        "trigger": trigger,
        "condition": {
            "kind": "leaf",
            "device_id": device_id,
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": threshold},
        },
        "actions": [
            {"type": "actuator_command", "device_id": device_id, "actuator": "fan1", "value": True}
        ],
    }


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


async def test_load_rule_cache_splits_by_trigger(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-t1@example.com", "AcmeT1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    metric_rule = await client.post(
        "/rules", json=_rule_body(device_id, {"type": "metric"}), headers=headers
    )
    sched_rule = await client.post(
        "/rules",
        json=_rule_body(device_id, {"type": "schedule", "cron": "0 8 * * *"}),
        headers=headers,
    )
    assert metric_rule.status_code == 201 and sched_rule.status_code == 201
    metric_id = uuid.UUID(metric_rule.json()["id"])
    sched_id = uuid.UUID(sched_rule.json()["id"])

    await rules_service.load_rule_cache(app_session_factory)

    signal = SignalKey(str(device_id), "temperature")
    assert [r.id for r in rules_service._rule_cache.get(signal, [])] == [metric_id]
    assert [r.id for r in rules_service.scheduled_rules_snapshot()] == [sched_id]
    assert set(rules_service._rules_by_id) == {metric_id, sched_id}

    # A metric arrival fires only the metric-triggered rule.
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device["device"]["slug"],
        "temperature",
        35.0,
        datetime.now(UTC),
    )
    executions = (await admin_session.execute(select(RuleExecution))).scalars().all()
    assert [e.rule_id for e in executions] == [metric_id]


async def test_tick_schedules_publishes_for_due_rule(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    _mock_redis_publish: AsyncMock,
) -> None:
    owner = await _register(client, "owner-t2@example.com", "AcmeT2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    resp = await client.post(
        "/rules",
        json=_rule_body(device["device"]["id"], {"type": "schedule", "cron": "* * * * *"}),
        headers=headers,
    )
    rule_id = resp.json()["id"]
    await rules_service.load_rule_cache(app_session_factory)

    _mock_redis_publish.reset_mock()
    await worker._tick_schedules()

    sched_calls = [
        c
        for c in _mock_redis_publish.call_args_list
        if c.args[0] == rules_service.RULES_MANUAL_CHANNEL
    ]
    assert len(sched_calls) == 1
    payload = json.loads(sched_calls[0].args[1])
    assert payload == {"tenant_id": tenant_id, "rule_id": rule_id, "trigger_source": "schedule"}


async def test_run_endpoint_role_gated(
    client: httpx.AsyncClient, _mock_redis_publish: AsyncMock
) -> None:
    owner = await _register(client, "owner-t3@example.com", "AcmeT3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = (
        await client.post(
            "/rules", json=_rule_body(device["device"]["id"], {"type": "manual"}), headers=headers
        )
    ).json()["id"]

    _mock_redis_publish.reset_mock()
    ok = await client.post(f"/rules/{rule_id}/run", headers=headers)
    assert ok.status_code == 202
    assert any(
        c.args[0] == rules_service.RULES_MANUAL_CHANNEL for c in _mock_redis_publish.call_args_list
    )

    missing = await client.post(f"/rules/{uuid.uuid4()}/run", headers=headers)
    assert missing.status_code == 404

    viewer = await _register(client, "viewer-t3@example.com", "ViewerHomeT3")
    await client.post(
        "/tenants/members",
        json={"email": "viewer-t3@example.com", "role": "viewer"},
        headers=headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)
    forbidden = await client.post(f"/rules/{rule_id}/run", headers=viewer_headers)
    assert forbidden.status_code == 403


async def _prime_signal(
    factory: async_sessionmaker[AsyncSession],
    mqtt: AsyncMock,
    tenant_id: str,
    device: dict[str, Any],
    tenant_slug: str,
    value: float,
) -> None:
    """evaluate_and_dispatch writes _signal_value_cache before checking the
    rule cache — so this primes the cache without firing a manual rule."""
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


async def test_manual_run_fires_when_condition_true_metric_null(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-t4@example.com", "AcmeT4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = (
        await client.post(
            "/rules",
            json=_rule_body(device["device"]["id"], {"type": "manual"}, threshold=300),
            headers=headers,
        )
    ).json()["id"]
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    await rules_service.load_rule_cache(app_session_factory)
    await _prime_signal(
        app_session_factory, mock_mqtt_client, tenant_id, device, tenant_slug, 500.0
    )

    raw = json.dumps({"tenant_id": tenant_id, "rule_id": rule_id, "trigger_source": "manual"})
    await worker._handle_rule_trigger(mock_mqtt_client, app_session_factory, raw)

    mock_mqtt_client.publish.assert_called()  # the actuator command
    execution = (await admin_session.execute(select(RuleExecution))).scalar_one()
    assert execution.trigger_source == "manual"
    assert execution.metric is None
    assert execution.value is None
    # A manual run never touches the persistent RuleState (bypasses for_duration).
    assert rules_service._rule_states.get(uuid.UUID(rule_id)) is None


async def test_manual_run_no_fire_when_condition_false(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner-t5@example.com", "AcmeT5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = (
        await client.post(
            "/rules", json=_rule_body(device["device"]["id"], {"type": "manual"}), headers=headers
        )
    ).json()["id"]
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    await rules_service.load_rule_cache(app_session_factory)
    await _prime_signal(app_session_factory, mock_mqtt_client, tenant_id, device, tenant_slug, 10.0)
    mock_mqtt_client.publish.reset_mock()

    raw = json.dumps({"tenant_id": tenant_id, "rule_id": rule_id, "trigger_source": "manual"})
    await worker._handle_rule_trigger(mock_mqtt_client, app_session_factory, raw)

    mock_mqtt_client.publish.assert_not_called()
    assert (await admin_session.execute(select(RuleExecution))).scalar_one_or_none() is None


async def test_create_rule_rejects_bad_cron(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-t6@example.com", "AcmeT6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    bad = await client.post(
        "/rules",
        json=_rule_body(device["device"]["id"], {"type": "schedule", "cron": "not a cron"}),
        headers=headers,
    )
    assert bad.status_code == 422
    bad_tz = await client.post(
        "/rules",
        json=_rule_body(
            device["device"]["id"], {"type": "schedule", "cron": "0 8 * * *", "timezone": "Mars/X"}
        ),
        headers=headers,
    )
    assert bad_tz.status_code == 422
    good = await client.post(
        "/rules",
        json=_rule_body(device["device"]["id"], {"type": "schedule", "cron": "0 8 * * *"}),
        headers=headers,
    )
    assert good.status_code == 201
    assert good.json()["trigger"] == {"type": "schedule", "cron": "0 8 * * *", "timezone": "UTC"}
