"""Integration tests for rule CRUD, role-gating, and RLS isolation — against
the real FastAPI app and iot_test Postgres.
"""

from typing import Any

import httpx

_ACTION = {"type": "actuator_command", "actuator": "fan1", "value": True}
_TEMPERATURE_CONDITION = {"kind": "leaf", "metric": "temperature", "operator": ">", "threshold": 30.0}


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
    assert body["device_id"] == device["device"]["id"]
    assert body["condition"] == {**_TEMPERATURE_CONDITION, "hysteresis": 0.0}
    assert body["type"] == "threshold"
    assert body["enabled"] is True
    assert body["action"] == _ACTION


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
    assert [r["device_name"] for r in body] == ["A Sensor", "B Sensor"]
    assert body[0]["device_slug"] == device_a["device"]["slug"]
    assert body[0]["condition"]["metric"] == "temperature"
    assert body[1]["device_slug"] == device_b["device"]["slug"]
    assert body[1]["condition"]["metric"] == "humidity"


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
