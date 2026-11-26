"""Errors and emails in the reader's language (DESIGN.md §11a)."""

import uuid

import httpx
import pytest

from app.notifications import email as email_module


class _Outbox:
    def __init__(self) -> None:
        self.messages: list[email_module.EmailMessage] = []

    async def send(self, message: email_module.EmailMessage) -> None:
        self.messages.append(message)


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> _Outbox:
    box = _Outbox()
    monkeypatch.setattr(email_module, "_provider", box)
    monkeypatch.setattr(email_module, "DELIVER_INLINE", True)
    return box


async def _owner(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    body = (
        await client.post(
            "/auth/register",
            json={"email": email, "password": "hunter2hunter2", "tenant_name": "Viña"},
        )
    ).json()
    return {
        "authorization": f"Bearer {body['access_token']}",
        "x-tenant-id": body["memberships"][0]["tenant_id"],
    }


async def test_errors_follow_accept_language(client: httpx.AsyncClient) -> None:
    h = await _owner(client, "i18n-err@example.com")
    missing = f"/devices/{uuid.uuid4()}"
    es = await client.get(missing, headers={**h, "accept-language": "es-MX,es;q=0.9"})
    assert es.status_code == 404
    assert es.json()["detail"] == "No se encontró el dispositivo"
    en = await client.get(missing, headers=h)
    assert en.json()["detail"] == "Device not found"


async def test_invitation_email_in_the_inviters_language(
    client: httpx.AsyncClient, outbox: _Outbox
) -> None:
    h = await _owner(client, "i18n-inviter@example.com")
    await client.patch("/auth/me", json={"locale": "es", "name": "Ana"}, headers=h)
    resp = await client.post(
        "/tenants/invitations", json={"email": "i18n-new@example.com", "role": "viewer"}, headers=h
    )
    assert resp.status_code == 201, resp.text
    sent = outbox.messages[-1]
    assert sent.subject == "Ana te invitó a Viña"
    assert "como Lector" in sent.body


async def test_reset_email_follows_the_page_language(
    client: httpx.AsyncClient, outbox: _Outbox
) -> None:
    await _owner(client, "i18n-reset@example.com")
    await client.post(
        "/auth/forgot-password",
        json={"email": "i18n-reset@example.com"},
        headers={"accept-language": "es-AR"},
    )
    assert outbox.messages[-1].subject == "Restablece tu contraseña"
