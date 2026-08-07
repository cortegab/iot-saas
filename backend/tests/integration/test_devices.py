"""Integration tests for device CRUD, credential handling, and role-gating —
against the real FastAPI app and iot_test Postgres.
"""

import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import verify_secret
from app.devices.models import Device


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
    """Every tenant gets an auto-created "Legacy / Uncategorized" catalog
    entry at registration (tenants/service.py's create_tenant_with_owner) —
    a fresh tenant's first entry is always that one.
    """
    resp = await client.get("/catalog", headers=headers)
    entries: list[dict[str, Any]] = resp.json()
    return str(entries[0]["id"])


async def test_create_device_returns_credential_once(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner@example.com", "Acme")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, headers)

    resp = await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["device"]["name"] == "Sensor 1"
    assert body["device"]["slug"] == "sensor-1"
    assert body["device"]["status"] == "active"
    assert body["device"]["catalog_entry_id"] == catalog_entry_id
    assert body["credential"]["username"] == body["device"]["id"]
    assert body["credential"]["password"]
    assert body["tenant_slug"] == "acme"

    # The credential must never appear again in list/get responses.
    listing = await client.get("/devices", headers=headers)
    assert listing.status_code == 200
    assert "credential" not in listing.json()[0]

    get_resp = await client.get(f"/devices/{body['device']['id']}", headers=headers)
    assert get_resp.status_code == 200
    assert "credential" not in get_resp.json()


async def test_duplicate_name_gets_disambiguated_slug(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, headers)

    first = await client.post(
        "/devices", json={"name": "Sensor", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    second = await client.post(
        "/devices", json={"name": "Sensor", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert first.json()["device"]["slug"] == "sensor"
    assert second.json()["device"]["slug"] == "sensor-2"


async def test_update_device_name_and_status(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, headers)

    created = await client.post(
        "/devices", json={"name": "Sensor", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    device_id = created.json()["device"]["id"]

    resp = await client.patch(
        f"/devices/{device_id}", json={"name": "Renamed", "status": "disabled"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["status"] == "disabled"


async def test_delete_device(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, headers)

    created = await client.post(
        "/devices", json={"name": "Sensor", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    device_id = created.json()["device"]["id"]

    resp = await client.delete(f"/devices/{device_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/devices/{device_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_rotate_credential_invalidates_old_one(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, headers)

    created = await client.post(
        "/devices", json={"name": "Sensor", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    device_id = created.json()["device"]["id"]
    old_password = created.json()["credential"]["password"]

    rotated = await client.post(f"/devices/{device_id}/rotate-credential", headers=headers)
    assert rotated.status_code == 200
    new_password = rotated.json()["credential"]["password"]
    assert new_password != old_password
    assert rotated.json()["tenant_slug"] == "acme5"

    # Verify against the stored hash directly (reaching into the DB as admin
    # purely to read it) that the new secret verifies and the old one no longer
    # does — this is exactly what an MQTT auth check would evaluate.
    async with admin_session.begin():
        row = (
            await admin_session.execute(select(Device).where(Device.id == uuid.UUID(device_id)))
        ).scalar_one()
        assert verify_secret(new_password, row.token_hash) is True
        assert verify_secret(old_password, row.token_hash) is False


async def test_viewer_cannot_create_device(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)

    viewer = await _register(client, "viewer6@example.com", "ViewerOwnTenant6")
    await client.post(
        "/tenants/members",
        json={"email": "viewer6@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    viewer_headers = _auth_headers(viewer, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, viewer_headers)
    resp = await client.post(
        "/devices",
        json={"name": "Sensor", "catalog_entry_id": catalog_entry_id},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


async def test_viewer_can_list_devices(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    catalog_entry_id = await _catalog_entry_id(client, owner_headers)
    await client.post(
        "/devices",
        json={"name": "Sensor", "catalog_entry_id": catalog_entry_id},
        headers=owner_headers,
    )

    viewer = await _register(client, "viewer7@example.com", "ViewerOwnTenant7")
    await client.post(
        "/tenants/members",
        json={"email": "viewer7@example.com", "role": "viewer"},
        headers=owner_headers,
    )

    viewer_headers = _auth_headers(viewer, tenant_id)
    resp = await client.get("/devices", headers=viewer_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_nonexistent_device_404(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner8@example.com", "Acme8")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.get("/devices/00000000-0000-0000-0000-000000000000", headers=headers)
    assert resp.status_code == 404


async def test_create_device_requires_catalog_entry_id(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner9@example.com", "Acme9")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.post("/devices", json={"name": "Sensor"}, headers=headers)
    assert resp.status_code == 422


async def test_create_device_with_foreign_tenants_catalog_entry_404(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "ownerA@example.com", "AcmeA")
    headers_a = _auth_headers(owner_a, owner_a["memberships"][0]["tenant_id"])
    foreign_catalog_entry_id = await _catalog_entry_id(client, headers_a)

    owner_b = await _register(client, "ownerB@example.com", "AcmeB")
    headers_b = _auth_headers(owner_b, owner_b["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/devices",
        json={"name": "Sensor", "catalog_entry_id": foreign_catalog_entry_id},
        headers=headers_b,
    )
    assert resp.status_code == 404


async def test_new_tenant_gets_legacy_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner10@example.com", "Acme10")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.get("/catalog", headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["name"] == "Legacy / Uncategorized"
    assert entries[0]["is_legacy"] is True
    assert entries[0]["metrics"] == []
    assert entries[0]["actuators"] == []
