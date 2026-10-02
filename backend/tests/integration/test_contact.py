"""Integration tests for POST /public/contact — the landing page's form:
emails CONTACT_EMAIL_TO, stores nothing, swallows honeypot hits, and is
rate-limited per client.
"""

from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.notifications import email as email_module

_FORM = {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "company": "Analytical Engines",
    "deployment": "on_prem",
    "devices": "100-500",
    "message": "We run three greenhouses and want to try it on site.",
}


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
    monkeypatch.setattr(settings, "contact_email_to", "sales@iodriven.tech")
    return box


async def test_enquiry_is_emailed_and_nothing_stored(
    client: httpx.AsyncClient, outbox: _Outbox, admin_session: AsyncSession
) -> None:
    resp = await client.post("/public/contact", json=_FORM)
    assert resp.status_code == 202
    [msg] = outbox.messages
    assert msg.to == ["sales@iodriven.tech"]
    assert msg.subject == "Website enquiry from Ada Lovelace"
    assert "Deployment: On-premise" in msg.body and "three greenhouses" in msg.body
    users = (await admin_session.execute(text("SELECT count(*) FROM users"))).scalar_one()
    assert users == 0  # no account, no row — the form stores nothing


async def test_honeypot_is_accepted_silently(client: httpx.AsyncClient, outbox: _Outbox) -> None:
    resp = await client.post("/public/contact", json={**_FORM, "website": "http://spam.example"})
    assert resp.status_code == 202
    assert outbox.messages == []


async def test_rate_limited_per_client(client: httpx.AsyncClient, outbox: _Outbox) -> None:
    headers = {"x-real-ip": "203.0.113.7"}
    for _ in range(5):
        assert (
            await client.post("/public/contact", json=_FORM, headers=headers)
        ).status_code == 202
    blocked = await client.post("/public/contact", json=_FORM, headers=headers)
    assert blocked.status_code == 429
    # Another client is unaffected.
    other = await client.post("/public/contact", json=_FORM, headers={"x-real-ip": "198.51.100.2"})
    assert other.status_code == 202
    assert len(outbox.messages) == 6


@pytest.mark.parametrize(
    "bad",
    [{"email": "not-an-email"}, {"company": ""}, {"deployment": "mars"}, {"devices": "lots"}],
)
async def test_invalid_input_is_rejected(
    client: httpx.AsyncClient, outbox: _Outbox, bad: dict[str, Any]
) -> None:
    resp = await client.post("/public/contact", json={**_FORM, **bad})
    assert resp.status_code == 422
    assert outbox.messages == []
