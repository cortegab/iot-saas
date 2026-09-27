"""On-clear actions end to end — against the real iot_test Postgres (RLS on),
with a mocked aiomqtt.Client. The motivating case: a switch on device A turns
an LED on device B on while pressed, and off again when released.
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications.models import Notification
from app.rules import service as rules_service
from app.rules.models import RuleExecution
from app.tenants.models import Tenant


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


async def _two_devices(
    client: httpx.AsyncClient, headers: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    out = []
    for name in ("Switch box", "LED box"):
        resp = await client.post(
            "/devices", json={"name": name, "catalog_entry_id": catalog_entry_id}, headers=headers
        )
        assert resp.status_code == 201
        out.append(resp.json()["device"])
    return out[0], out[1]


def _switch_led_rule(switch_id: str, led_id: str, **policy: Any) -> dict[str, Any]:
    return {
        "name": "Switch -> LED",
        "condition": {
            "kind": "leaf",
            "device_id": switch_id,
            "metric": "switch",
            "operator": "==",
            "rhs": {"source": "static", "value": 1},
        },
        "execution_policy": policy,
        "actions": [
            {"type": "actuator_command", "device_id": led_id, "actuator": "led", "value": True}
        ],
        "clear_actions": [
            {"type": "actuator_command", "device_id": led_id, "actuator": "led", "value": False}
        ],
    }


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(
        select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id))
    )
    return result.scalar_one()


def _published(mqtt: AsyncMock) -> list[tuple[str, Any]]:
    return [(c.args[0], json.loads(c.args[1])["value"]) for c in mqtt.publish.call_args_list]


async def test_switch_release_turns_the_led_on_another_device_off(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    owner = await _register(client, "owner-clear1@example.com", "AcmeClear1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    switch, led = await _two_devices(client, headers)

    resp = await client.post(
        "/rules", json=_switch_led_rule(switch["id"], led["id"]), headers=headers
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["clear_actions"][0]["value"] is False
    assert body["execution_policy"]["clear_for_duration"] == 0
    assert {(d["device_id"], d["role"]) for d in body["devices"]} == {
        (switch["id"], "input"),
        (led["id"], "target"),
    }

    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    mqtt = AsyncMock()

    async def reading(value: float) -> None:
        await rules_service.evaluate_and_dispatch(
            mqtt,
            app_session_factory,
            uuid.UUID(tenant_id),
            uuid.UUID(switch["id"]),
            tenant_slug,
            switch["slug"],
            "switch",
            value,
            datetime.now(UTC),
        )

    await reading(1)
    await reading(1)  # still pressed — nothing new
    await reading(0)
    await reading(0)  # still released — no second clear

    led_topic = f"{tenant_slug}/{led['slug']}"
    assert _published(mqtt) == [
        (f"{led_topic}/cmd/led", True),
        (f"{led_topic}/state/led", True),
        (f"{led_topic}/cmd/led", False),
        (f"{led_topic}/state/led", False),  # retained desired state follows
    ]

    executions = (
        (
            await admin_session.execute(
                select(RuleExecution)
                .where(RuleExecution.rule_id == uuid.UUID(body["id"]))
                .order_by(RuleExecution.fired_at)
            )
        )
        .scalars()
        .all()
    )
    assert [e.edge for e in executions] == ["fire", "clear"]
    assert executions[1].summary.startswith("Cleared:")

    # Only the firing writes the automatic platform notification.
    notifications = (
        (
            await admin_session.execute(
                select(Notification).where(Notification.rule_id == uuid.UUID(body["id"]))
            )
        )
        .scalars()
        .all()
    )
    assert len(notifications) == 1

    history = await client.get(f"/rules/{body['id']}/executions", headers=headers)
    assert history.status_code == 200
    assert sorted(row["edge"] for row in history.json()) == ["clear", "fire"]


async def test_clear_actions_only_allowed_on_metric_triggers(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner-clear2@example.com", "AcmeClear2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    switch, led = await _two_devices(client, headers)

    scheduled = {
        **_switch_led_rule(switch["id"], led["id"]),
        "trigger": {"type": "schedule", "cron": "0 * * * *"},
    }
    resp = await client.post("/rules", json=scheduled, headers=headers)
    assert resp.status_code == 422
    assert "clear actions" in resp.text

    created = await client.post(
        "/rules", json=_switch_led_rule(switch["id"], led["id"]), headers=headers
    )
    rule_id = created.json()["id"]
    resp = await client.patch(
        f"/rules/{rule_id}",
        json={"trigger": {"type": "schedule", "cron": "0 * * * *"}},
        headers=headers,
    )
    assert resp.status_code == 422

    resp = await client.patch(
        f"/rules/{rule_id}",
        json={"trigger": {"type": "schedule", "cron": "0 * * * *"}, "clear_actions": []},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["clear_actions"] == []


async def test_clear_delay_is_completed_by_the_pending_timer_path(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    """An on_change switch sends one "released" reading and goes quiet — the
    clear delay has to be finished by pending_timer_loop's re-evaluation."""
    owner = await _register(client, "owner-clear3@example.com", "AcmeClear3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    switch, led = await _two_devices(client, headers)
    created = await client.post(
        "/rules",
        json=_switch_led_rule(switch["id"], led["id"], clear_for_duration=1),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    rule_id = uuid.UUID(created.json()["id"])

    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    mqtt = AsyncMock()
    for value in (1, 0):
        await rules_service.evaluate_and_dispatch(
            mqtt,
            app_session_factory,
            uuid.UUID(tenant_id),
            uuid.UUID(switch["id"]),
            tenant_slug,
            switch["slug"],
            "switch",
            value,
            datetime.now(UTC),
        )
    assert [v for _, v in _published(mqtt)] == [True, True]  # released, delay pending
    assert [r.id for r in rules_service.pending_timer_rules()] == [rule_id]

    await asyncio.sleep(1.1)
    await rules_service.run_rule_out_of_band(
        mqtt, app_session_factory, uuid.UUID(tenant_id), rule_id, "metric"
    )
    assert [v for _, v in _published(mqtt)] == [True, True, False, False]
    assert rules_service.pending_timer_rules() == []

    edges = (
        await admin_session.execute(
            select(RuleExecution.edge, RuleExecution.trigger_source)
            .where(RuleExecution.rule_id == rule_id)
            .order_by(RuleExecution.fired_at)
        )
    ).all()
    assert [tuple(row) for row in edges] == [("fire", "metric"), ("clear", "metric")]
