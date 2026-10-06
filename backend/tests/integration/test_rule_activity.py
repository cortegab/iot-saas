"""Integration tests for GET /rules/activity — the rules list's mini strips:
fires bucketed over the window, held spans only for rules that record
clears, and tenant scoping — against the real FastAPI app and iot_test.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.rules.models import RuleExecution

_CONDITION = {
    "kind": "leaf",
    "metric": "temperature",
    "operator": ">",
    "rhs": {"source": "static", "value": 30.0},
}
_FAN_ON = {"type": "actuator_command", "actuator": "fan1", "value": True}
_FAN_OFF = {"type": "actuator_command", "actuator": "fan1", "value": False}


async def _setup(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str, str]:
    reg = await client.post(
        "/auth/register",
        json={
            "email": f"o-{tag}@example.com",
            "password": "hunter2hunter2",
            "tenant_name": f"Act {tag}",
        },
    )
    body: dict[str, Any] = reg.json()
    tenant_id = body["memberships"][0]["tenant_id"]
    headers = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}
    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    device = (
        await client.post(
            "/devices", json={"name": "S1", "catalog_entry_id": entry}, headers=headers
        )
    ).json()
    return headers, tenant_id, device["device"]["id"]


async def _rule(
    client: httpx.AsyncClient, headers: dict[str, str], device_id: str, *, clears: bool
) -> str:
    body: dict[str, Any] = {
        "name": "clears" if clears else "plain",
        "condition": {**_CONDITION, "device_id": device_id},
        "actions": [{**_FAN_ON, "device_id": device_id}],
    }
    if clears:
        body["clear_actions"] = [{**_FAN_OFF, "device_id": device_id}]
    resp = await client.post("/rules", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _exec(
    admin: AsyncSession, tenant_id: str, rule_id: str, ago: timedelta, edge: str
) -> None:
    admin.add(
        RuleExecution(
            tenant_id=uuid.UUID(tenant_id),
            rule_id=uuid.UUID(rule_id),
            metric="temperature",
            value=31.0,
            edge=edge,
            fired_at=datetime.now(UTC) - ago,
            summary=edge,
        )
    )
    await admin.commit()


async def test_fires_land_in_their_buckets(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id, device_id = await _setup(client, "a1")
    rule_id = await _rule(client, headers, device_id, clears=False)
    await _exec(admin_session, tenant_id, rule_id, timedelta(hours=23, minutes=50), "fire")
    await _exec(admin_session, tenant_id, rule_id, timedelta(minutes=5), "fire")
    await _exec(
        admin_session, tenant_id, rule_id, timedelta(hours=30), "fire"
    )  # outside the window

    [row] = (await client.get("/rules/activity", headers=headers)).json()
    assert row["rule_id"] == rule_id
    assert len(row["cells"]) == 48
    assert row["fired"] == 2
    assert row["cells"][0] == "fired" and row["cells"][-1] == "fired"
    # Nothing between firings is known for a rule without clears.
    assert set(row["cells"][1:-1]) == {"idle"}


async def test_held_span_between_fire_and_clear(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id, device_id = await _setup(client, "a2")
    rule_id = await _rule(client, headers, device_id, clears=True)
    await _exec(admin_session, tenant_id, rule_id, timedelta(hours=10), "fire")
    await _exec(admin_session, tenant_id, rule_id, timedelta(hours=8), "clear")

    [row] = (await client.get("/rules/activity", headers=headers)).json()
    cells = row["cells"]
    fired_at = cells.index("fired")
    assert cells[fired_at + 1 : fired_at + 4] == ["true", "true", "true"]
    assert cells[-1] == "idle"


async def test_held_from_before_the_window(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, tenant_id, device_id = await _setup(client, "a3")
    rule_id = await _rule(client, headers, device_id, clears=True)
    await _exec(admin_session, tenant_id, rule_id, timedelta(hours=30), "fire")  # still held

    [row] = (await client.get("/rules/activity", headers=headers)).json()
    assert row["fired"] == 0
    assert set(row["cells"]) == {"true"}


async def test_activity_is_tenant_scoped(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers_a, tenant_a, device_a = await _setup(client, "a4")
    rule_a = await _rule(client, headers_a, device_a, clears=False)
    await _exec(admin_session, tenant_a, rule_a, timedelta(hours=1), "fire")
    headers_b, _, _ = await _setup(client, "a5")
    assert (await client.get("/rules/activity", headers=headers_b)).json() == []
