"""Integration tests for the notifications REST endpoints — listing,
mark-all-read, and tenant isolation. Rule-firing creates a notification row
too; that behavior is covered in test_commands.py alongside the rest of
_dispatch_action's per-action-type behavior, not duplicated here.
"""

import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications import service as notifications_service


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


async def test_list_notifications_empty_by_default(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)

    resp = await client.get("/notifications", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_notifications_newest_first(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])
    headers = _auth_headers(owner, str(tenant_id))

    await notifications_service.create_notification(
        app_session_factory, tenant_id, None, None, "first"
    )
    await notifications_service.create_notification(
        app_session_factory, tenant_id, None, None, "second"
    )

    resp = await client.get("/notifications", headers=headers)
    assert resp.status_code == 200
    messages = [n["message"] for n in resp.json()]
    assert messages == ["second", "first"]
    assert all(n["read_at"] is None for n in resp.json())


async def test_mark_all_read_clears_unread(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])
    headers = _auth_headers(owner, str(tenant_id))

    await notifications_service.create_notification(
        app_session_factory, tenant_id, None, None, "unread one"
    )
    await notifications_service.create_notification(
        app_session_factory, tenant_id, None, None, "unread two"
    )

    resp = await client.post("/notifications/read", headers=headers)
    assert resp.status_code == 200
    assert all(n["read_at"] is not None for n in resp.json())

    refetched = await client.get("/notifications", headers=headers)
    assert all(n["read_at"] is not None for n in refetched.json())


async def test_notifications_tenant_isolation(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    owner_a = await _register(client, "owner4@example.com", "Acme4")
    tenant_a = uuid.UUID(owner_a["memberships"][0]["tenant_id"])
    await notifications_service.create_notification(
        app_session_factory, tenant_a, None, None, "tenant A's notification"
    )

    owner_b = await _register(client, "owner5@example.com", "Acme5")
    tenant_b = owner_b["memberships"][0]["tenant_id"]
    headers_b = _auth_headers(owner_b, tenant_b)

    resp = await client.get("/notifications", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json() == []
