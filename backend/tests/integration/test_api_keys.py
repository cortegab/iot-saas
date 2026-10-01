"""Integration tests for API keys: CRUD (create/list/revoke) and key-based
authentication (Bearer iot_…) — against the real FastAPI app and iot_test
Postgres, through the lookup_api_key SECURITY DEFINER function and RLS.
"""

from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


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


async def _owner_with_key(
    client: httpx.AsyncClient, email: str, role: str = "viewer", **extra: Any
) -> tuple[dict[str, str], str, dict[str, Any]]:
    owner = await _register(client, email, f"T-{email}")
    tenant_id = owner["memberships"][0]["tenant_id"]
    created = await client.post(
        "/api-keys",
        json={"name": "Integration", "role": role, **extra},
        headers=_auth_headers(owner, tenant_id),
    )
    assert created.status_code == 201, created.text
    return _auth_headers(owner, tenant_id), tenant_id, created.json()


def _key_headers(key: str, tenant_id: str | None = None) -> dict[str, str]:
    headers = {"authorization": f"Bearer {key}"}
    if tenant_id:
        headers["x-tenant-id"] = tenant_id
    return headers


async def test_key_authenticates_without_tenant_header(client: httpx.AsyncClient) -> None:
    _, tenant_id, created = await _owner_with_key(client, "k1@example.com")
    assert created["api_key"]["expires_at"] is not None  # 90 days by default

    resp = await client.get("/devices", headers=_key_headers(created["key"]))
    assert resp.status_code == 200
    # A matching X-Tenant-Id is fine too.
    same = await client.get("/devices", headers=_key_headers(created["key"], tenant_id))
    assert same.status_code == 200


async def test_key_records_last_used(client: httpx.AsyncClient) -> None:
    owner_headers, _, created = await _owner_with_key(client, "k2@example.com")
    assert created["api_key"]["last_used_at"] is None
    await client.get("/devices", headers=_key_headers(created["key"]))
    listing = await client.get("/api-keys", headers=owner_headers)
    assert listing.json()[0]["last_used_at"] is not None


async def test_viewer_key_cannot_write(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k3@example.com")
    resp = await client.post("/zones", json={"name": "Bay 1"}, headers=_key_headers(created["key"]))
    assert resp.status_code == 403


async def test_admin_key_can_write(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k4@example.com", role="admin")
    resp = await client.post("/zones", json={"name": "Bay 1"}, headers=_key_headers(created["key"]))
    assert resp.status_code == 201


async def test_key_cannot_manage_keys_members_or_dashboards(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k5@example.com", role="admin")
    headers = _key_headers(created["key"])
    assert (await client.get("/api-keys", headers=headers)).status_code == 403
    assert (await client.post("/api-keys", json={"name": "x"}, headers=headers)).status_code in (
        401,
        403,
    )
    assert (await client.get("/tenants/members", headers=headers)).status_code == 403
    assert (
        await client.post("/tenants/invitations", json={"email": "x@example.com"}, headers=headers)
    ).status_code == 403
    # Personal routes need a person.
    assert (await client.get("/dashboards", headers=headers)).status_code == 401
    assert (await client.get("/auth/me", headers=headers)).status_code == 401


async def test_revoked_key_is_refused(client: httpx.AsyncClient) -> None:
    owner_headers, _, created = await _owner_with_key(client, "k6@example.com")
    await client.delete(f"/api-keys/{created['api_key']['id']}", headers=owner_headers)
    resp = await client.get("/devices", headers=_key_headers(created["key"]))
    assert resp.status_code == 401


async def test_expired_key_is_refused(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    _, _, created = await _owner_with_key(client, "k7@example.com")
    await admin_session.execute(
        text("UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = :id"),
        {"id": created["api_key"]["id"]},
    )
    await admin_session.commit()
    resp = await client.get("/devices", headers=_key_headers(created["key"]))
    assert resp.status_code == 401


async def test_wrong_secret_and_garbage_are_refused(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k8@example.com")
    good = created["key"]
    tampered = good[:-4] + ("AAAA" if not good.endswith("AAAA") else "BBBB")
    for bad in (tampered, "iot_", "iot_nothere_secret", "iot_x"):
        resp = await client.get("/devices", headers=_key_headers(bad))
        assert resp.status_code == 401, bad


async def test_key_for_another_tenant_header_is_refused(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k9@example.com")
    other = await _register(client, "k9-other@example.com", "Other9")
    other_tenant = other["memberships"][0]["tenant_id"]
    resp = await client.get("/devices", headers=_key_headers(created["key"], other_tenant))
    assert resp.status_code == 403


async def test_key_sees_only_its_own_tenant(client: httpx.AsyncClient) -> None:
    _, _, created = await _owner_with_key(client, "k10@example.com", role="admin")
    other = await _register(client, "k10-other@example.com", "Other10")
    other_tenant = other["memberships"][0]["tenant_id"]
    await client.post(
        "/zones", json={"name": "Not yours"}, headers=_auth_headers(other, other_tenant)
    )
    resp = await client.get("/zones", headers=_key_headers(created["key"]))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_owner_role_key_is_refused(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner_headers, _, _ = await _owner_with_key(client, "k11@example.com")
    resp = await client.post(
        "/api-keys", json={"name": "x", "role": "owner"}, headers=owner_headers
    )
    assert resp.status_code == 422

    # A legacy owner key (created before the rule) can't authenticate either.
    _, _, created = await _owner_with_key(client, "k12@example.com")
    await admin_session.execute(
        text("UPDATE api_keys SET role = 'owner' WHERE id = :id"),
        {"id": created["api_key"]["id"]},
    )
    await admin_session.commit()
    resp = await client.get("/devices", headers=_key_headers(created["key"]))
    assert resp.status_code == 401


@pytest.mark.parametrize("days", [None, 30])
async def test_expiry_choice(client: httpx.AsyncClient, days: int | None) -> None:
    _, _, created = await _owner_with_key(client, f"k13-{days}@example.com", expires_in_days=days)
    assert (created["api_key"]["expires_at"] is None) == (days is None)


async def test_user_token_still_needs_tenant_header(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "k14@example.com", "T14")
    resp = await client.get(
        "/devices", headers={"authorization": f"Bearer {owner['access_token']}"}
    )
    assert resp.status_code == 422
