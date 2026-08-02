"""Integration tests for tenant membership management: additional tenant
creation, adding/removing members, role changes, and role-gated authorization
— against the real FastAPI app and iot_test Postgres.
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


async def test_create_additional_tenant(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner@example.com", "First")
    headers = {"authorization": f"Bearer {owner['access_token']}"}

    resp = await client.post("/tenants", json={"name": "Second"}, headers=headers)
    assert resp.status_code == 201
    second_tenant_id = resp.json()["id"]

    mine = await client.get("/tenants/mine", headers=headers)
    assert mine.status_code == 200
    memberships = mine.json()
    tenant_ids = {m["tenant_id"] for m in memberships}
    assert len(tenant_ids) == 2
    assert second_tenant_id in tenant_ids
    assert all(m["role"] == "owner" for m in memberships)


async def test_add_member_and_list(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme")
    tenant_id = owner["memberships"][0]["tenant_id"]
    await _register(client, "member2@example.com", "MemberOwnTenant")

    headers = _auth_headers(owner, tenant_id)
    resp = await client.post(
        "/tenants/members",
        json={"email": "member2@example.com", "role": "viewer"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "viewer"

    listing = await client.get("/tenants/members", headers=headers)
    assert listing.status_code == 200
    emails = {m["email"] for m in listing.json()}
    assert emails == {"owner2@example.com", "member2@example.com"}


async def test_add_member_unknown_email_404(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post(
        "/tenants/members",
        json={"email": "nobody@example.com", "role": "viewer"},
        headers=headers,
    )
    assert resp.status_code == 404


async def test_add_member_already_member_409(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post(
        "/tenants/members",
        json={"email": "owner4@example.com", "role": "viewer"},
        headers=headers,
    )
    assert resp.status_code == 409


async def test_viewer_cannot_add_members(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)

    viewer = await _register(client, "viewer5@example.com", "ViewerOwnTenant")
    await client.post(
        "/tenants/members",
        json={"email": "viewer5@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    viewer_headers = _auth_headers(viewer, tenant_id)
    resp = await client.post(
        "/tenants/members",
        json={"email": "owner5@example.com", "role": "viewer"},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


async def test_change_role_and_remove_member(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    await _register(client, "member6@example.com", "MemberOwnTenant6")
    add_resp = await client.post(
        "/tenants/members",
        json={"email": "member6@example.com", "role": "viewer"},
        headers=headers,
    )
    member_user_id = add_resp.json()["user_id"]

    change_resp = await client.patch(
        f"/tenants/members/{member_user_id}", json={"role": "admin"}, headers=headers
    )
    assert change_resp.status_code == 200
    assert change_resp.json()["role"] == "admin"

    remove_resp = await client.delete(f"/tenants/members/{member_user_id}", headers=headers)
    assert remove_resp.status_code == 204

    listing = await client.get("/tenants/members", headers=headers)
    emails = {m["email"] for m in listing.json()}
    assert emails == {"owner6@example.com"}


async def test_non_member_denied_tenant_context(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    tenant_id = owner["memberships"][0]["tenant_id"]

    outsider = await _register(client, "outsider7@example.com", "OutsiderTenant7")
    outsider_headers = _auth_headers(outsider, tenant_id)  # outsider's token, owner's tenant

    resp = await client.get("/tenants/members", headers=outsider_headers)
    assert resp.status_code == 403


async def test_missing_tenant_header_rejected(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner8@example.com", "Acme8")
    headers = {"authorization": f"Bearer {owner['access_token']}"}
    resp = await client.get("/tenants/members", headers=headers)
    assert resp.status_code == 422
