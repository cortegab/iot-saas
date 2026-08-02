"""Integration tests for API key CRUD (create/list/revoke) — against the real
FastAPI app and iot_test Postgres. CRUD-only this phase: no test here exercises
key-based authentication, since that path isn't wired up yet (see
api_keys/models.py's module docstring).
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


async def test_create_api_key_returns_secret_once(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner@example.com", "Acme")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post(
        "/api-keys", json={"name": "CI key", "role": "viewer"}, headers=headers
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["key"].startswith("iot_")
    assert body["api_key"]["name"] == "CI key"
    assert body["api_key"]["role"] == "viewer"
    assert body["api_key"]["revoked_at"] is None

    listing = await client.get("/api-keys", headers=headers)
    assert listing.status_code == 200
    assert "key" not in listing.json()[0]
    assert listing.json()[0]["key_prefix"] == body["api_key"]["key_prefix"]


async def test_revoke_api_key(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    created = await client.post(
        "/api-keys", json={"name": "CI key", "role": "viewer"}, headers=headers
    )
    key_id = created.json()["api_key"]["id"]

    resp = await client.delete(f"/api-keys/{key_id}", headers=headers)
    assert resp.status_code == 204

    listing = await client.get("/api-keys", headers=headers)
    revoked = next(k for k in listing.json() if k["id"] == key_id)
    assert revoked["revoked_at"] is not None


async def test_revoke_nonexistent_key_404(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.delete("/api-keys/00000000-0000-0000-0000-000000000000", headers=headers)
    assert resp.status_code == 404


async def test_viewer_cannot_create_or_list_api_keys(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)

    viewer = await _register(client, "viewer4@example.com", "ViewerOwnTenant4")
    await client.post(
        "/tenants/members",
        json={"email": "viewer4@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    viewer_headers = _auth_headers(viewer, tenant_id)
    create_resp = await client.post(
        "/api-keys", json={"name": "x", "role": "viewer"}, headers=viewer_headers
    )
    assert create_resp.status_code == 403

    list_resp = await client.get("/api-keys", headers=viewer_headers)
    assert list_resp.status_code == 403


async def test_api_keys_isolated_across_tenants(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "a@example.com", "TenantA")
    tenant_a = owner_a["memberships"][0]["tenant_id"]
    await client.post(
        "/api-keys",
        json={"name": "A key", "role": "viewer"},
        headers=_auth_headers(owner_a, tenant_a),
    )

    owner_b = await _register(client, "b@example.com", "TenantB")
    tenant_b = owner_b["memberships"][0]["tenant_id"]

    listing_b = await client.get("/api-keys", headers=_auth_headers(owner_b, tenant_b))
    assert listing_b.status_code == 200
    assert listing_b.json() == []
