"""Integration tests for rule CRUD, role-gating, and RLS isolation — against
the real FastAPI app and iot_test Postgres.
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.rules import service as rules_service
from app.tenants.models import Tenant

_ACTION = {"type": "actuator_command", "actuator": "fan1", "value": True}
_TEMPERATURE_CONDITION = {"kind": "leaf", "metric": "temperature", "operator": ">", "threshold": 30.0}


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(
        select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id))
    )
    return result.scalar_one()


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


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
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": name, "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _create_rule(
    client: httpx.AsyncClient, headers: dict[str, str], device_id: str, **overrides: Any
) -> httpx.Response:
    body = {"condition": _TEMPERATURE_CONDITION, "action": _ACTION, **overrides}
    return await client.post(f"/devices/{device_id}/rules", json=body, headers=headers)


async def test_create_rule_returns_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)

    resp = await _create_rule(client, headers, device["device"]["id"])
    assert resp.status_code == 201
    body = resp.json()
    device_id = device["device"]["id"]
    assert "device_id" not in body
    assert body["condition"]["metric"] == "temperature"
    assert body["condition"]["operator"] == ">"
    assert body["condition"]["threshold"] == 30.0
    assert body["condition"]["hysteresis"] == 0.0
    assert body["condition"]["device_id"] == device_id
    assert body["type"] == "threshold"
    assert body["enabled"] is True
    assert body["action"]["type"] == "actuator_command"
    assert body["actions"] == [{**_ACTION, "device_id": device_id}]
    assert body["name"]
    assert {(d["device_id"], d["role"]) for d in body["devices"]} == {
        (device_id, "input"),
        (device_id, "target"),
    }
    assert all(d["device_name"] == device["device"]["name"] for d in body["devices"])


async def test_list_rules(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    await _create_rule(client, headers, device["device"]["id"])
    await _create_rule(
        client,
        headers,
        device["device"]["id"],
        condition={"kind": "leaf", "metric": "humidity", "operator": ">", "threshold": 30.0},
    )

    resp = await client.get(f"/devices/{device['device']['id']}/rules", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_get_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    created = await _create_rule(client, headers, device["device"]["id"])
    rule_id = created.json()["id"]

    resp = await client.get(f"/rules/{rule_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == rule_id


async def test_update_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    created = await _create_rule(client, headers, device["device"]["id"])
    rule_id = created.json()["id"]

    resp = await client.patch(
        f"/rules/{rule_id}",
        json={
            "condition": {"kind": "leaf", "metric": "temperature", "operator": ">", "threshold": 40.0},
            "enabled": False,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["condition"]["threshold"] == 40.0
    assert body["enabled"] is False


async def test_update_rule_to_multi_predicate_condition(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4b@example.com", "Acme4b")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    created = await _create_rule(client, headers, device["device"]["id"])
    rule_id = created.json()["id"]

    and_condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [
            {"kind": "leaf", "metric": "temperature", "operator": ">", "threshold": 30.0},
            {"kind": "leaf", "metric": "humidity", "operator": "<", "threshold": 40.0},
        ],
    }
    resp = await client.patch(f"/rules/{rule_id}", json={"condition": and_condition}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["condition"]["kind"] == "group"
    assert body["condition"]["op"] == "AND"
    assert len(body["condition"]["predicates"]) == 2


async def test_delete_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    created = await _create_rule(client, headers, device["device"]["id"])
    rule_id = created.json()["id"]

    resp = await client.delete(f"/rules/{rule_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/rules/{rule_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_viewer_cannot_create_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, owner_headers)

    viewer = await _register(client, "viewer6@example.com", "ViewerOwnTenant6")
    await client.post(
        "/tenants/members",
        json={"email": "viewer6@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    resp = await _create_rule(client, viewer_headers, device["device"]["id"])
    assert resp.status_code == 403


async def test_viewer_can_list_rules(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, owner_headers)
    await _create_rule(client, owner_headers, device["device"]["id"])

    viewer = await _register(client, "viewer7@example.com", "ViewerOwnTenant7")
    await client.post(
        "/tenants/members",
        json={"email": "viewer7@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    resp = await client.get(f"/devices/{device['device']['id']}/rules", headers=viewer_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_nonexistent_rule_404(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner8@example.com", "Acme8")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.get("/rules/00000000-0000-0000-0000-000000000000", headers=headers)
    assert resp.status_code == 404


async def test_cross_tenant_rule_404(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner9@example.com", "Acme9")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device_a = await _create_device(client, headers_a)
    created = await _create_rule(client, headers_a, device_a["device"]["id"])
    rule_id = created.json()["id"]

    owner_b = await _register(client, "owner10@example.com", "Acme10")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get(f"/rules/{rule_id}", headers=headers_b)
    assert resp.status_code == 404


async def test_create_rule_for_cross_tenant_device_404(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner11@example.com", "Acme11")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device_a = await _create_device(client, headers_a)

    owner_b = await _register(client, "owner12@example.com", "Acme12")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await _create_rule(client, headers_b, device_a["device"]["id"])
    assert resp.status_code == 404


async def test_list_all_rules_across_devices(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner13@example.com", "Acme13")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    device_a = await _create_device(client, headers, name="A Sensor")
    device_b = await _create_device(client, headers, name="B Sensor")
    rule_a = await _create_rule(client, headers, device_a["device"]["id"])
    rule_b = await _create_rule(
        client,
        headers,
        device_b["device"]["id"],
        condition={"kind": "leaf", "metric": "humidity", "operator": ">", "threshold": 30.0},
    )
    assert rule_a.status_code == 201
    assert rule_b.status_code == 201

    resp = await client.get("/rules", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    # Ordered by rule name; neither carries a singular device pointer.
    assert [r["name"] for r in body] == sorted(r["name"] for r in body)
    assert all("device_id" not in r for r in body)
    by_metric = {r["condition"]["metric"]: r for r in body}
    assert {d["device_name"] for d in by_metric["temperature"]["devices"]} == {"A Sensor"}
    assert {d["device_name"] for d in by_metric["humidity"]["devices"]} == {"B Sensor"}


async def test_list_all_rules_tenant_isolation(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner14@example.com", "Acme14")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device_a = await _create_device(client, headers_a)
    await _create_rule(client, headers_a, device_a["device"]["id"])

    owner_b = await _register(client, "owner15@example.com", "Acme15")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get("/rules", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_viewer_can_list_all_rules(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner16@example.com", "Acme16")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, owner_headers)
    await _create_rule(client, owner_headers, device["device"]["id"])

    viewer = await _register(client, "viewer16@example.com", "ViewerOwnTenant16")
    await client.post(
        "/tenants/members",
        json={"email": "viewer16@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    resp = await client.get("/rules", headers=viewer_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_create_canonical_multi_device_rule(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner17@example.com", "Acme17")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device_a = await _create_device(client, headers, name="A")
    device_b = await _create_device(client, headers, name="B")
    a_id = device_a["device"]["id"]
    b_id = device_b["device"]["id"]

    body = {
        "name": "Cross-device interlock",
        "condition": {
            "kind": "group",
            "op": "AND",
            "predicates": [
                {"kind": "leaf", "device_id": a_id, "metric": "temperature", "operator": ">", "threshold": 80.0},
                {"kind": "leaf", "device_id": b_id, "metric": "pressure", "operator": ">", "threshold": 120.0},
            ],
        },
        "execution_policy": {"strategy": "edge", "for_duration": 5, "cooldown": 30},
        "actions": [
            {"type": "actuator_command", "device_id": b_id, "actuator": "fan1", "value": True},
            {"type": "notification", "message": "both breached"},
        ],
    }
    resp = await client.post("/rules", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    rule = resp.json()
    assert rule["name"] == "Cross-device interlock"
    assert len(rule["actions"]) == 2
    assert rule["for_duration"] == 5
    assert {(d["device_id"], d["role"]) for d in rule["devices"]} == {
        (a_id, "input"),
        (b_id, "input"),
        (b_id, "target"),
    }
    # The rule shows up under both input devices.
    for did in (a_id, b_id):
        listed = await client.get(f"/devices/{did}/rules", headers=headers)
        assert any(r["id"] == rule["id"] for r in listed.json())


async def test_canonical_rule_rejects_cross_tenant_device(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner18@example.com", "Acme18")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device_a = await _create_device(client, headers_a)

    owner_b = await _register(client, "owner19@example.com", "Acme19")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)
    device_b = await _create_device(client, headers_b)

    body = {
        "name": "sneaky",
        "condition": {
            "kind": "leaf",
            "device_id": device_b["device"]["id"],
            "metric": "temperature",
            "operator": ">",
            "threshold": 1.0,
        },
        "actions": [
            {"type": "actuator_command", "device_id": device_a["device"]["id"], "actuator": "x", "value": True}
        ],
    }
    resp = await client.post("/rules", json=body, headers=headers_a)
    assert resp.status_code == 422


async def test_list_rule_executions_newest_first_and_nests_actions(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "ownerExec1@example.com", "AcmeExec1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    created = await _create_rule(client, headers, device_id)
    rule_id = created.json()["id"]

    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    for value in (35.0, 36.0):
        await rules_service.evaluate_and_dispatch(
            mock_mqtt_client,
            app_session_factory,
            uuid.UUID(tenant_id),
            uuid.UUID(device_id),
            tenant_slug,
            device_slug,
            "temperature",
            value,
            datetime.now(UTC),
        )

    resp = await client.get(f"/rules/{rule_id}/executions", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    # Newest first.
    assert body[0]["value"] == 36.0
    assert body[1]["value"] == 35.0
    for execution in body:
        assert execution["device_name"] == device["device"]["name"]
        action_types = {a["action_type"] for a in execution["actions"]}
        assert action_types == {"actuator_command", "notification"}


async def test_list_rule_executions_cross_tenant_404(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "ownerExec2a@example.com", "AcmeExec2a")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    device_a = await _create_device(client, headers_a)
    created = await _create_rule(client, headers_a, device_a["device"]["id"])
    rule_id = created.json()["id"]

    owner_b = await _register(client, "ownerExec2b@example.com", "AcmeExec2b")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get(f"/rules/{rule_id}/executions", headers=headers_b)
    assert resp.status_code == 404


async def test_rule_execution_summary_is_a_snapshot_not_a_live_join(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "ownerExec3@example.com", "AcmeExec3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    created = await _create_rule(client, headers, device_id)
    rule_id = created.json()["id"]

    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device_slug,
        "temperature",
        35.0,
        datetime.now(UTC),
    )

    before = await client.get(f"/rules/{rule_id}/executions", headers=headers)
    original_summary = before.json()[0]["summary"]
    assert "30.0" in original_summary

    await client.patch(
        f"/rules/{rule_id}",
        json={
            "name": "Renamed",
            "condition": {
                "kind": "leaf",
                "metric": "temperature",
                "operator": ">",
                "threshold": 99.0,
            },
        },
        headers=headers,
    )

    after = await client.get(f"/rules/{rule_id}/executions", headers=headers)
    assert after.json()[0]["summary"] == original_summary
