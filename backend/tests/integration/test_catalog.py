"""Integration tests for device catalog entry CRUD, role-gating, RLS
isolation, and the delete-blocked-while-in-use behavior — against the real
FastAPI app and iot_test Postgres.
"""

from typing import Any

import httpx


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


async def test_new_tenant_starts_with_one_legacy_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.get("/catalog", headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["is_legacy"] is True


async def test_create_catalog_entry_with_metrics_and_actuators(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={
            "name": "Temperature Sensor v2",
            "metrics": [{"name": "temperature", "unit": "°C", "min": -20.0, "max": 80.0}],
            "actuators": [
                {"name": "fan1", "value_type": "bool", "allowed_values": None},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Temperature Sensor v2"
    assert body["is_legacy"] is False
    assert body["metrics"] == [
        {"name": "temperature", "unit": "°C", "data_type": "float", "min": -20.0, "max": 80.0}
    ]
    assert body["actuators"] == [{"name": "fan1", "value_type": "bool", "allowed_values": None}]


async def test_list_returns_legacy_plus_created(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    await client.post("/catalog", json={"name": "Custom"}, headers=headers)

    resp = await client.get("/catalog", headers=headers)
    names = {e["name"] for e in resp.json()}
    assert names == {"Legacy / Uncategorized", "Custom"}


async def test_update_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post("/catalog", json={"name": "Original"}, headers=headers)
    entry_id = created.json()["id"]

    resp = await client.patch(f"/catalog/{entry_id}", json={"name": "Renamed"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_delete_unused_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post("/catalog", json={"name": "Unused"}, headers=headers)
    entry_id = created.json()["id"]

    resp = await client.delete(f"/catalog/{entry_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_catalog_entry_in_use_by_device_returns_409(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]

    await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": entry_id}, headers=headers
    )

    resp = await client.delete(f"/catalog/{entry_id}", headers=headers)
    assert resp.status_code == 409

    # Still there and still usable — a failed delete must not corrupt state.
    get_resp = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_catalog_tenant_isolation(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "ownerA@example.com", "AcmeA")
    headers_a = _auth_headers(owner_a, owner_a["memberships"][0]["tenant_id"])
    entry_a = await client.post("/catalog", json={"name": "OnlyA"}, headers=headers_a)
    entry_a_id = entry_a.json()["id"]

    owner_b = await _register(client, "ownerB@example.com", "AcmeB")
    headers_b = _auth_headers(owner_b, owner_b["memberships"][0]["tenant_id"])

    listing_b = await client.get("/catalog", headers=headers_b)
    assert "OnlyA" not in {e["name"] for e in listing_b.json()}

    get_b = await client.get(f"/catalog/{entry_a_id}", headers=headers_b)
    assert get_b.status_code == 404


async def test_viewer_can_list_but_not_create_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    owner_headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    viewer = await _register(client, "viewer7@example.com", "ViewerOwnTenant7")
    await client.post(
        "/tenants/members",
        json={"email": "viewer7@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, owner["memberships"][0]["tenant_id"])

    list_resp = await client.get("/catalog", headers=viewer_headers)
    assert list_resp.status_code == 200

    create_resp = await client.post("/catalog", json={"name": "Nope"}, headers=viewer_headers)
    assert create_resp.status_code == 403
