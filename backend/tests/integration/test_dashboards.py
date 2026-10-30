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


async def _catalog_entry_id(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    resp = await client.get("/catalog", headers=headers)
    entries: list[dict[str, Any]] = resp.json()
    return str(entries[0]["id"])


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
    catalog_entry_id = await _catalog_entry_id(client, headers)
    device = await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
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
    created = await client.post(
        "/dashboards", json={"name": "Owner's dashboard"}, headers=owner_headers
    )
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


async def _default_id(client: httpx.AsyncClient, headers: dict[str, str]) -> str | None:
    """The id of the dashboard marked default, if any."""
    resp = await client.get("/dashboards", headers=headers)
    assert resp.status_code == 200
    return next((str(d["id"]) for d in resp.json() if d["is_default"]), None)


async def test_default_dashboard_set_replace_and_clear(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner8@example.com", "Acme8")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    a = (await client.post("/dashboards", json={"name": "A"}, headers=headers)).json()["id"]
    b = (await client.post("/dashboards", json={"name": "B"}, headers=headers)).json()["id"]
    assert await _default_id(client, headers) is None

    assert (await client.put(f"/dashboards/{a}/default", headers=headers)).status_code == 204
    listed = (await client.get("/dashboards", headers=headers)).json()
    assert [d["is_default"] for d in listed] == [True, False]
    assert (await client.get(f"/dashboards/{a}", headers=headers)).json()["is_default"] is True
    assert await _default_id(client, headers) == a

    # One default per person: B replaces A.
    await client.put(f"/dashboards/{b}/default", headers=headers)
    listed = (await client.get("/dashboards", headers=headers)).json()
    assert [d["is_default"] for d in listed] == [False, True]

    # Clearing A (not the default) leaves B; clearing B clears it.
    await client.delete(f"/dashboards/{a}/default", headers=headers)
    assert await _default_id(client, headers) == b
    assert (await client.delete(f"/dashboards/{b}/default", headers=headers)).status_code == 204
    assert await _default_id(client, headers) is None


async def test_deleting_the_default_dashboard_clears_it(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner9@example.com", "Acme9")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    a = (await client.post("/dashboards", json={"name": "A"}, headers=headers)).json()["id"]
    await client.put(f"/dashboards/{a}/default", headers=headers)

    assert (await client.delete(f"/dashboards/{a}", headers=headers)).status_code == 204
    assert await _default_id(client, headers) is None


async def test_cannot_set_someone_elses_dashboard_as_default(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner10@example.com", "Acme10")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    mine = (await client.post("/dashboards", json={"name": "Mine"}, headers=owner_headers)).json()

    teammate = await _register(client, "teammate10@example.com", "TeammateOwnTenant10")
    await client.post(
        "/tenants/members",
        json={"email": "teammate10@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    teammate_headers = _auth_headers(teammate, tenant_id)
    resp = await client.put(f"/dashboards/{mine['id']}/default", headers=teammate_headers)
    assert resp.status_code == 404
    assert await _default_id(client, teammate_headers) is None

    # Another workspace can't reach it either.
    other = await _register(client, "owner11@example.com", "Acme11")
    other_headers = _auth_headers(other, other["memberships"][0]["tenant_id"])
    resp = await client.put(f"/dashboards/{mine['id']}/default", headers=other_headers)
    assert resp.status_code == 404
