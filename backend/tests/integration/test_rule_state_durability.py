"""Integration tests for Phase 5 state durability + the rule_health worker
loop — app.rules.service.snapshot_rule_states / restore_rule_states and
emit_rule_health_transitions. Real iot_test Postgres; Redis KV + pub/sub are
the conftest in-memory mocks.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.rules import service as rules_service
from app.rules.evaluators import MetricValue, RuleState, SignalKey


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


async def test_rule_state_checkpoint_round_trip(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    redis_kv: dict[str, str],
) -> None:
    owner = await _register(client, "owner-sd1@example.com", "AcmeSD1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    rule_id = uuid.UUID(await _create_rule(client, headers, device["device"]["id"]))
    await rules_service.load_rule_cache(app_session_factory)

    fired_at = datetime.now(UTC) - timedelta(minutes=5)
    since = datetime.now(UTC) - timedelta(seconds=30)
    rules_service._rule_states[rule_id] = RuleState(
        condition_since=since, armed=False, last_fired_at=fired_at, condition_fingerprint="fp1"
    )
    await rules_service.snapshot_rule_states()

    blob = json.loads(redis_kv[rules_service.RULE_STATE_REDIS_KEY])
    assert str(rule_id) in blob
    # a rule that no longer exists in _rules_by_id must be skipped on restore
    blob[str(uuid.uuid4())] = {"armed": False, "condition_since": None, "last_fired_at": None}
    redis_kv[rules_service.RULE_STATE_REDIS_KEY] = json.dumps(blob)

    rules_service._rule_states.clear()
    await rules_service.restore_rule_states()

    assert set(rules_service._rule_states) == {rule_id}
    restored = rules_service._rule_states[rule_id]
    assert restored.armed is False
    assert restored.condition_since == since
    assert restored.last_fired_at == fired_at
    assert restored.condition_fingerprint == "fp1"


async def test_rule_health_transitions_emit_event_and_notification(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    _mock_redis_publish: AsyncMock,
) -> None:
    owner = await _register(client, "owner-sd2@example.com", "AcmeSD2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    rule_id = await _create_rule(client, headers, device_id)
    await rules_service.load_rule_cache(app_session_factory)

    signal = SignalKey(device_id, "temperature")
    rules_service._signal_value_cache[signal] = MetricValue(
        value=25.0, timestamp=datetime.now(UTC), max_age_seconds=90
    )

    async def _notification_count() -> int:
        result = await admin_session.execute(
            text("SELECT count(*) FROM notifications WHERE tenant_id = :t"), {"t": tenant_id}
        )
        return int(result.scalar_one())

    def _rule_health_events() -> list[dict[str, Any]]:
        out = []
        for call in _mock_redis_publish.call_args_list:
            try:
                payload = json.loads(call.args[1])
            except (IndexError, ValueError):
                continue
            if payload.get("type") == "rule_health":
                out.append(payload)
        return out

    # 1st pass: baseline only — no event, no alert
    await rules_service.emit_rule_health_transitions(app_session_factory)
    assert _rule_health_events() == []
    assert await _notification_count() == 0

    # signal goes stale -> transition to un-evaluatable
    rules_service._signal_value_cache[signal] = MetricValue(
        value=25.0, timestamp=datetime.now(UTC) - timedelta(hours=1), max_age_seconds=90
    )
    _mock_redis_publish.reset_mock()
    await rules_service.emit_rule_health_transitions(app_session_factory)
    events = _rule_health_events()
    assert len(events) == 1
    assert events[0] == {"type": "rule_health", "rule_id": rule_id, "evaluatable": False}
    assert await _notification_count() == 1

    # still stale -> no duplicate notification (1h debounce), no new event
    _mock_redis_publish.reset_mock()
    await rules_service.emit_rule_health_transitions(app_session_factory)
    assert _rule_health_events() == []
    assert await _notification_count() == 1

    # recovers -> event, but no notification
    rules_service._signal_value_cache[signal] = MetricValue(
        value=25.0, timestamp=datetime.now(UTC), max_age_seconds=90
    )
    _mock_redis_publish.reset_mock()
    await rules_service.emit_rule_health_transitions(app_session_factory)
    events = _rule_health_events()
    assert len(events) == 1
    assert events[0]["evaluatable"] is True
    assert await _notification_count() == 1
