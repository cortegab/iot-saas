"""Integration tests for zones: CRUD, device assignment, delete blocked while
assigned, role gating and RLS isolation — against the real FastAPI app and
iot_test Postgres."""

import uuid
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import set_tenant_context


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


async def _setup(client: httpx.AsyncClient, email: str) -> tuple[dict[str, str], str]:
    owner = await _register(client, email, f"T-{email}")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    return headers, entry_id


async def test_zone_crud_and_unique_names(client: httpx.AsyncClient) -> None:
    headers, _ = await _setup(client, "z1@example.com")
    created = await client.post(
        "/zones", json={"name": "Bay 1", "notes": "North side"}, headers=headers
    )
    assert created.status_code == 201
    zone = created.json()
    assert zone["name"] == "Bay 1" and zone["notes"] == "North side" and zone["device_count"] == 0

    dup = await client.post("/zones", json={"name": "bay 1"}, headers=headers)
    assert dup.status_code == 409

    renamed = await client.patch(
        f"/zones/{zone['id']}", json={"name": "Bay 1 north"}, headers=headers
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Bay 1 north"
    assert renamed.json()["notes"] == "North side"  # notes untouched when omitted

    cleared = await client.patch(f"/zones/{zone['id']}", json={"notes": None}, headers=headers)
    assert cleared.json()["notes"] is None

    listing = await client.get("/zones", headers=headers)
    assert [z["name"] for z in listing.json()] == ["Bay 1 north"]


async def test_devices_join_zones_and_delete_is_blocked_while_assigned(
    client: httpx.AsyncClient,
) -> None:
    headers, entry_id = await _setup(client, "z2@example.com")
    zone_id = (await client.post("/zones", json={"name": "Cold room"}, headers=headers)).json()[
        "id"
    ]

    device = await client.post(
        "/devices",
        json={"name": "Probe", "catalog_entry_id": entry_id, "zone_id": zone_id},
        headers=headers,
    )
    assert device.status_code == 201
    device_id = device.json()["device"]["id"]
    assert device.json()["device"]["zone_id"] == zone_id
    assert (await client.get(f"/zones/{zone_id}", headers=headers)).json()["device_count"] == 1

    blocked = await client.delete(f"/zones/{zone_id}", headers=headers)
    assert blocked.status_code == 409
    assert "1 device is assigned" in blocked.json()["detail"]

    # Renaming the device doesn't touch its zone; an explicit null clears it.
    kept = await client.patch(f"/devices/{device_id}", json={"name": "Probe 2"}, headers=headers)
    assert kept.json()["zone_id"] == zone_id
    cleared = await client.patch(f"/devices/{device_id}", json={"zone_id": None}, headers=headers)
    assert cleared.json()["zone_id"] is None

    assert (await client.delete(f"/zones/{zone_id}", headers=headers)).status_code == 204


async def test_unknown_or_foreign_zone_is_404(client: httpx.AsyncClient) -> None:
    headers_a, entry_a = await _setup(client, "z3a@example.com")
    headers_b, _ = await _setup(client, "z3b@example.com")
    zone_b = (await client.post("/zones", json={"name": "B only"}, headers=headers_b)).json()["id"]

    assert (await client.get(f"/zones/{zone_b}", headers=headers_a)).status_code == 404
    assert "B only" not in [
        z["name"] for z in (await client.get("/zones", headers=headers_a)).json()
    ]
    resp = await client.post(
        "/devices",
        json={"name": "X", "catalog_entry_id": entry_a, "zone_id": zone_b},
        headers=headers_a,
    )
    assert resp.status_code == 404
    resp = await client.post(
        "/devices",
        json={"name": "Y", "catalog_entry_id": entry_a, "zone_id": str(uuid.uuid4())},
        headers=headers_a,
    )
    assert resp.status_code == 404


async def test_viewer_can_read_but_not_write_zones(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "z4@example.com", "Z4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    viewer = await _register(client, "z4v@example.com", "Z4V")
    await client.post(
        "/tenants/members",
        json={"email": "z4v@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    assert (await client.get("/zones", headers=viewer_headers)).status_code == 200
    assert (
        await client.post("/zones", json={"name": "Nope"}, headers=viewer_headers)
    ).status_code == 403


async def test_zones_rls_isolation(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Real RLS, not the service's WHERE clause: as iot_app with tenant A in
    context, tenant B's zone rows are invisible even to a raw SELECT."""
    headers_a, _ = await _setup(client, "z5a@example.com")
    headers_b, _ = await _setup(client, "z5b@example.com")
    await client.post("/zones", json={"name": "A zone"}, headers=headers_a)
    await client.post("/zones", json={"name": "B zone"}, headers=headers_b)
    tenant_a = uuid.UUID(headers_a["x-tenant-id"])

    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, tenant_a)
        names = (await session.execute(text("SELECT name FROM zones"))).scalars().all()
    assert names == ["A zone"]
