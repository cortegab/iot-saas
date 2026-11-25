"""Simple view (DESIGN.md §15a; ease-of-use plan C2): each person's choice per
workspace, defaulting by role, and never a permission."""

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


def _headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def test_view_defaults_by_role_and_each_person_chooses_their_own(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "view-owner@example.com", "View Co")
    tenant = owner["memberships"][0]["tenant_id"]
    oh = _headers(owner, tenant)
    viewer = await _register(client, "view-client@example.com", "Own space")
    assert (
        await client.post(
            "/tenants/members",
            json={"email": "view-client@example.com", "role": "viewer"},
            headers=oh,
        )
    ).status_code == 201
    vh = _headers(viewer, tenant)

    assert (await client.get("/tenants/current/view", headers=oh)).json() == {
        "interface_mode": "full",
        "chosen": False,
    }
    assert (await client.get("/tenants/current/view", headers=vh)).json() == {
        "interface_mode": "simple",
        "chosen": False,
    }

    # A viewer may pick Full for themselves: it hides less, it grants nothing.
    resp = await client.patch("/tenants/current/view", json={"interface_mode": "full"}, headers=vh)
    assert resp.json() == {"interface_mode": "full", "chosen": True}
    assert (
        await client.post("/devices", json={"name": "x", "catalog_entry_id": None}, headers=vh)
    ).status_code in (403, 422)
    # The owner's choice is theirs alone.
    await client.patch("/tenants/current/view", json={"interface_mode": "simple"}, headers=oh)
    assert (await client.get("/tenants/current/view", headers=vh)).json()[
        "interface_mode"
    ] == "full"
    # null goes back to the role's default.
    resp = await client.patch("/tenants/current/view", json={"interface_mode": None}, headers=vh)
    assert resp.json() == {"interface_mode": "simple", "chosen": False}
    # Only the two views exist.
    assert (
        await client.patch("/tenants/current/view", json={"interface_mode": "pro"}, headers=oh)
    ).status_code == 422
