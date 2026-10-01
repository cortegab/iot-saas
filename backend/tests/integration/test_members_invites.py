"""Integration tests for member role guards, invitations and password reset —
against the real FastAPI app and iot_test Postgres. Emailed links are
captured with a recording email provider."""

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications import email as email_module


class _Outbox:
    def __init__(self) -> None:
        self.messages: list[email_module.EmailMessage] = []

    async def send(self, message: email_module.EmailMessage) -> None:
        self.messages.append(message)

    def last_token(self, path: str) -> str:
        for m in reversed(self.messages):
            found = re.search(rf"{path}[/=]([A-Za-z0-9_-]+)", m.body)
            if found:
                return found.group(1)
        raise AssertionError(f"no {path} link sent")


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> _Outbox:
    box = _Outbox()
    monkeypatch.setattr(email_module, "_provider", box)
    monkeypatch.setattr(email_module, "DELIVER_INLINE", True)
    return box


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


async def _add(
    client: httpx.AsyncClient, owner_headers: dict[str, str], email: str, role: str
) -> dict[str, Any]:
    person = await _register(client, email, f"own-{email}")
    resp = await client.post(
        "/tenants/members", json={"email": email, "role": role}, headers=owner_headers
    )
    assert resp.status_code == 201, resp.text
    return person


# ---- role guards -------------------------------------------------------------


async def test_admin_cannot_grant_or_touch_owner(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "g1o@example.com", "G1")
    tenant = owner["memberships"][0]["tenant_id"]
    oh = _headers(owner, tenant)
    admin = await _add(client, oh, "g1a@example.com", "admin")
    viewer = await _add(client, oh, "g1v@example.com", "viewer")
    ah = _headers(admin, tenant)
    owner_id = (await client.get("/auth/me", headers=oh)).json()["id"]
    viewer_id = (await client.get("/auth/me", headers=_headers(viewer, tenant))).json()["id"]

    assert (
        await client.patch(f"/tenants/members/{viewer_id}", json={"role": "owner"}, headers=ah)
    ).status_code == 403
    assert (
        await client.patch(f"/tenants/members/{owner_id}", json={"role": "viewer"}, headers=ah)
    ).status_code == 403
    assert (await client.delete(f"/tenants/members/{owner_id}", headers=ah)).status_code == 403
    assert (
        await client.post(
            "/tenants/invitations", json={"email": "x@example.com", "role": "owner"}, headers=ah
        )
    ).status_code == 403
    # Admin → admin is fine.
    assert (
        await client.patch(f"/tenants/members/{viewer_id}", json={"role": "admin"}, headers=ah)
    ).status_code == 200


async def test_last_owner_cannot_be_demoted_removed_or_leave(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "g2o@example.com", "G2")
    tenant = owner["memberships"][0]["tenant_id"]
    oh = _headers(owner, tenant)
    owner_id = (await client.get("/auth/me", headers=oh)).json()["id"]

    assert (
        await client.patch(f"/tenants/members/{owner_id}", json={"role": "admin"}, headers=oh)
    ).status_code == 409
    assert (await client.delete(f"/tenants/members/{owner_id}", headers=oh)).status_code == 409
    assert (await client.post("/tenants/leave", headers=oh)).status_code == 409

    second = await _add(client, oh, "g2b@example.com", "viewer")
    second_id = (await client.get("/auth/me", headers=_headers(second, tenant))).json()["id"]
    assert (
        await client.patch(f"/tenants/members/{second_id}", json={"role": "owner"}, headers=oh)
    ).status_code == 200
    # With two owners, the first may step down or leave.
    assert (await client.post("/tenants/leave", headers=oh)).status_code == 204


async def test_viewer_can_leave(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "g3o@example.com", "G3")
    tenant = owner["memberships"][0]["tenant_id"]
    viewer = await _add(client, _headers(owner, tenant), "g3v@example.com", "viewer")
    vh = _headers(viewer, tenant)
    assert (await client.post("/tenants/leave", headers=vh)).status_code == 204
    assert (await client.get("/tenants/current", headers=vh)).status_code == 403


# ---- invitations ---------------------------------------------------------------


async def test_invite_new_person_who_signs_up_from_the_link(
    client: httpx.AsyncClient, outbox: _Outbox
) -> None:
    owner = await _register(client, "i1o@example.com", "Invite One")
    tenant = owner["memberships"][0]["tenant_id"]
    oh = _headers(owner, tenant)

    created = await client.post(
        "/tenants/invitations",
        json={"email": "New.Person@Example.com", "role": "admin"},
        headers=oh,
    )
    assert created.status_code == 201
    assert created.json()["email"] == "new.person@example.com"
    assert [i["email"] for i in (await client.get("/tenants/invitations", headers=oh)).json()] == [
        "new.person@example.com"
    ]
    token = outbox.last_token("/invite")
    assert outbox.messages[-1].to == ["new.person@example.com"]

    preview = await client.get(f"/auth/invitations/{token}")
    assert preview.status_code == 200
    assert preview.json()["tenant_name"] == "Invite One"
    assert preview.json()["account_exists"] is False

    no_password = await client.post(f"/auth/invitations/{token}/accept", json={})
    assert no_password.status_code == 422

    accepted = await client.post(
        f"/auth/invitations/{token}/accept", json={"name": "New Person", "password": "longenough1"}
    )
    assert accepted.status_code == 200, accepted.text
    assert [(m["tenant_id"], m["role"]) for m in accepted.json()["memberships"]] == [
        (tenant, "admin")
    ]

    # Single use, and no longer pending.
    assert (await client.get(f"/auth/invitations/{token}")).status_code == 410
    assert (await client.get("/tenants/invitations", headers=oh)).json() == []
    members = (await client.get("/tenants/members", headers=oh)).json()
    joined = next(m for m in members if m["email"] == "new.person@example.com")
    assert joined["name"] == "New Person" and joined["role"] == "admin" and joined["joined_at"]


async def test_existing_account_must_sign_in_as_the_invited_email(
    client: httpx.AsyncClient, outbox: _Outbox
) -> None:
    owner = await _register(client, "i2o@example.com", "Invite Two")
    tenant = owner["memberships"][0]["tenant_id"]
    invitee = await _register(client, "i2x@example.com", "Invitee own")
    other = await _register(client, "i2y@example.com", "Other own")
    await client.post(
        "/tenants/invitations",
        json={"email": "i2x@example.com", "role": "viewer"},
        headers=_headers(owner, tenant),
    )
    token = outbox.last_token("/invite")

    assert (await client.get(f"/auth/invitations/{token}")).json()["account_exists"] is True
    anon = await client.post(f"/auth/invitations/{token}/accept", json={"password": "longenough1"})
    assert anon.status_code == 409
    wrong = await client.post(
        f"/auth/invitations/{token}/accept",
        json={},
        headers={"authorization": f"Bearer {other['access_token']}"},
    )
    assert wrong.status_code == 403
    right = await client.post(
        f"/auth/invitations/{token}/accept",
        json={},
        headers={"authorization": f"Bearer {invitee['access_token']}"},
    )
    assert right.status_code == 200
    assert tenant in {m["tenant_id"] for m in right.json()["memberships"]}


async def test_duplicate_resend_cancel_and_expiry(
    client: httpx.AsyncClient, outbox: _Outbox, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "i3o@example.com", "Invite Three")
    tenant = owner["memberships"][0]["tenant_id"]
    oh = _headers(owner, tenant)
    inv = (
        await client.post("/tenants/invitations", json={"email": "p@example.com"}, headers=oh)
    ).json()
    first = outbox.last_token("/invite")
    assert (
        await client.post("/tenants/invitations", json={"email": "P@example.com"}, headers=oh)
    ).status_code == 409
    assert (
        await client.post("/tenants/invitations", json={"email": "i3o@example.com"}, headers=oh)
    ).status_code == 409

    assert (
        await client.post(f"/tenants/invitations/{inv['id']}/resend", headers=oh)
    ).status_code == 200
    second = outbox.last_token("/invite")
    assert second != first
    assert (await client.get(f"/auth/invitations/{first}")).status_code == 404
    assert (await client.get(f"/auth/invitations/{second}")).status_code == 200

    await admin_session.execute(
        text("UPDATE invitations SET expires_at = :t WHERE id = :id"),
        {"t": datetime.now(UTC) - timedelta(minutes=1), "id": inv["id"]},
    )
    await admin_session.commit()
    assert (await client.get(f"/auth/invitations/{second}")).status_code == 410

    assert (await client.delete(f"/tenants/invitations/{inv['id']}", headers=oh)).status_code == 204
    assert (await client.get("/tenants/invitations", headers=oh)).json() == []


async def test_viewer_cannot_invite(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "i4o@example.com", "Invite Four")
    tenant = owner["memberships"][0]["tenant_id"]
    viewer = await _add(client, _headers(owner, tenant), "i4v@example.com", "viewer")
    resp = await client.post(
        "/tenants/invitations", json={"email": "z@example.com"}, headers=_headers(viewer, tenant)
    )
    assert resp.status_code == 403


# ---- password reset ----------------------------------------------------------


async def test_password_reset_flow(client: httpx.AsyncClient, outbox: _Outbox) -> None:
    person = await _register(client, "r1@example.com", "Reset One")

    unknown = await client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    known = await client.post("/auth/forgot-password", json={"email": "R1@example.com"})
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    token = outbox.last_token("reset-password\\?token")

    assert (
        await client.post("/auth/reset-password", json={"token": token, "password": "short"})
    ).status_code == 422
    assert (
        await client.post(
            "/auth/reset-password", json={"token": token, "password": "brand-new-pass"}
        )
    ).status_code == 204
    # Single use; the old password and old refresh tokens stop working.
    assert (
        await client.post(
            "/auth/reset-password", json={"token": token, "password": "another-pass1"}
        )
    ).status_code == 400
    assert (
        await client.post(
            "/auth/login", json={"email": "r1@example.com", "password": "hunter2hunter2"}
        )
    ).status_code == 401
    assert (
        await client.post(
            "/auth/login", json={"email": "r1@example.com", "password": "brand-new-pass"}
        )
    ).status_code == 200
    assert (
        await client.post("/auth/refresh", json={"refresh_token": person["refresh_token"]})
    ).status_code == 401


async def test_password_reset_requests_are_rate_limited(
    client: httpx.AsyncClient, outbox: _Outbox
) -> None:
    await _register(client, "r2@example.com", "Reset Two")
    for _ in range(5):
        assert (
            await client.post("/auth/forgot-password", json={"email": "r2@example.com"})
        ).status_code == 202
    assert len([m for m in outbox.messages if m.to == ["r2@example.com"]]) == 3
