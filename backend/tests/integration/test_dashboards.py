"""Integration tests for dashboard CRUD and ownership isolation — against the
real FastAPI app and iot_test Postgres.
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


async def test_create_dashboard_starts_with_empty_layout(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post("/dashboards", json={"name": "Overview"}, headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Overview"
    assert body["layout"] == []


async def test_list_dashboards_returns_only_mine(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    await client.post("/dashboards", json={"name": "A"}, headers=headers)
    await client.post("/dashboards", json={"name": "B"}, headers=headers)

    resp = await client.get("/dashboards", headers=headers)
    assert resp.status_code == 200
    assert [d["name"] for d in resp.json()] == ["A", "B"]


async def test_update_dashboard_layout_and_name(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await client.post("/devices", json={"name": "Sensor 1"}, headers=headers)
    device_id = device.json()["device"]["id"]
    created = await client.post("/dashboards", json={"name": "Overview"}, headers=headers)
    dashboard_id = created.json()["id"]

    widget = {
        "id": "w1",
        "type": "value_card",
        "x": 0,
        "y": 0,
        "w": 4,
        "h": 3,
        "device_id": device_id,
        "metric": "temperature",
    }
    resp = await client.patch(
        f"/dashboards/{dashboard_id}",
        json={"name": "Renamed", "layout": [widget]},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Renamed"
    expected_widget = {**widget, "min": None, "max": None}
    assert body["layout"] == [expected_widget]

    refetched = await client.get(f"/dashboards/{dashboard_id}", headers=headers)
    assert refetched.json()["layout"] == [expected_widget]


async def test_delete_dashboard(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await client.post("/dashboards", json={"name": "Overview"}, headers=headers)
    dashboard_id = created.json()["id"]

    resp = await client.delete(f"/dashboards/{dashboard_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/dashboards/{dashboard_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_dashboard_not_visible_to_other_member_of_same_tenant(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    created = await client.post("/dashboards", json={"name": "Owner's dashboard"}, headers=owner_headers)
    dashboard_id = created.json()["id"]

    teammate = await _register(client, "teammate5@example.com", "TeammateOwnTenant5")
    await client.post(
        "/tenants/members",
        json={"email": "teammate5@example.com", "role": "admin"},
        headers=owner_headers,
    )
    teammate_headers = _auth_headers(teammate, tenant_id)

    list_resp = await client.get("/dashboards", headers=teammate_headers)
    assert list_resp.status_code == 200
    assert list_resp.json() == []

    get_resp = await client.get(f"/dashboards/{dashboard_id}", headers=teammate_headers)
    assert get_resp.status_code == 404

    patch_resp = await client.patch(
        f"/dashboards/{dashboard_id}", json={"name": "Hijacked"}, headers=teammate_headers
    )
    assert patch_resp.status_code == 404

    delete_resp = await client.delete(f"/dashboards/{dashboard_id}", headers=teammate_headers)
    assert delete_resp.status_code == 404


async def test_dashboard_tenant_isolation(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "owner6@example.com", "Acme6")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    headers_a = _auth_headers(owner_a, tenant_a)
    await client.post("/dashboards", json={"name": "A's dashboard"}, headers=headers_a)

    owner_b = await _register(client, "owner7@example.com", "Acme7")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get("/dashboards", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json() == []
