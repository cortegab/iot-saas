"""Integration tests for workspace settings (PATCH /tenants/current): the
time zone, alert recipients, and who may change what — against the real
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


async def _workspace_with(
    client: httpx.AsyncClient, tag: str, role: str
) -> tuple[dict[str, str], dict[str, str]]:
    """(owner headers, member-with-`role` headers) for a fresh workspace."""
    owner = await _register(client, f"owner-{tag}@example.com", f"WS {tag}")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    member = await _register(client, f"{role}-{tag}@example.com", f"Own {tag}")
    added = await client.post(
        "/tenants/members",
        json={"email": f"{role}-{tag}@example.com", "role": role},
        headers=owner_headers,
    )
    assert added.status_code == 201
    return owner_headers, _auth_headers(member, tenant_id)


async def test_timezone_defaults_to_utc_and_can_change(client: httpx.AsyncClient) -> None:
    owner_headers, _ = await _workspace_with(client, "tz1", "viewer")
    assert (await client.get("/tenants/current", headers=owner_headers)).json()["timezone"] == "UTC"

    resp = await client.patch(
        "/tenants/current", json={"timezone": "Europe/Madrid"}, headers=owner_headers
    )
    assert resp.status_code == 200
    assert resp.json()["timezone"] == "Europe/Madrid"


async def test_unknown_timezone_is_rejected(client: httpx.AsyncClient) -> None:
    owner_headers, _ = await _workspace_with(client, "tz2", "viewer")
    for bad in ("Mars/Olympus", "../etc/passwd", ""):
        resp = await client.patch("/tenants/current", json={"timezone": bad}, headers=owner_headers)
        assert resp.status_code == 422, bad


async def test_admin_edits_recipients_and_timezone_but_not_name(
    client: httpx.AsyncClient,
) -> None:
    _, admin_headers = await _workspace_with(client, "adm", "admin")
    resp = await client.patch(
        "/tenants/current",
        json={"notification_emails": ["Ops@Example.com", "ops@example.com"], "timezone": "UTC"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    # Normalised and de-duplicated.
    assert resp.json()["notification_emails"] == ["ops@example.com"]

    rename = await client.patch(
        "/tenants/current", json={"name": "Hijacked"}, headers=admin_headers
    )
    assert rename.status_code == 403


async def test_viewer_cannot_change_settings(client: httpx.AsyncClient) -> None:
    _, viewer_headers = await _workspace_with(client, "vw", "viewer")
    resp = await client.patch(
        "/tenants/current", json={"timezone": "Europe/Oslo"}, headers=viewer_headers
    )
    assert resp.status_code == 403


async def test_bad_recipient_is_rejected(client: httpx.AsyncClient) -> None:
    owner_headers, _ = await _workspace_with(client, "rc", "viewer")
    resp = await client.patch(
        "/tenants/current",
        json={"notification_emails": ["ops@example.com", "not-an-email"]},
        headers=owner_headers,
    )
    assert resp.status_code == 422
