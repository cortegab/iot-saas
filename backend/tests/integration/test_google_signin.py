"""Sign in with Google (ease-of-use plan B5), against the real app and
iot_test. Google's keys are replaced by a local RSA key; everything else (the
signature, audience, issuer, expiry and email checks) runs for real."""

import re
import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import google
from app.config import settings
from app.notifications import email as email_module

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
WEB = "web-client.apps.googleusercontent.com"


def _token(**claims: Any) -> str:
    now = int(time.time())
    body = {
        "iss": "https://accounts.google.com",
        "aud": WEB,
        "sub": "google-sub-1",
        "email": "ana@example.com",
        "email_verified": True,
        "name": "Ana Ruiz",
        "iat": now,
        "exp": now + 600,
        **claims,
    }
    return jwt.encode(
        {k: v for k, v in body.items() if v is not None},
        KEY,
        algorithm="RS256",
        headers={"kid": "test"},
    )


@pytest.fixture
def google_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id_web", WEB)

    async def local_key(_token: str) -> Any:
        return KEY.public_key()

    monkeypatch.setattr(google, "signing_key_for", local_key)


async def _google(client: httpx.AsyncClient, token: str, **extra: Any) -> httpx.Response:
    return await client.post("/auth/google", json={"id_token": token, **extra})


async def test_off_until_a_client_id_is_set(client: httpx.AsyncClient) -> None:
    resp = await _google(client, _token())
    assert resp.status_code == 404
    meta = (await client.get("/meta/client")).json()
    assert meta["google_client_id_web"] is None


@pytest.mark.usefixtures("google_on")
async def test_first_sign_in_makes_an_account_and_workspace_then_signs_back_in(
    client: httpx.AsyncClient,
) -> None:
    assert (await client.get("/meta/client")).json()["google_client_id_web"] == WEB
    first = await _google(client, _token())
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["access_token"] and body["refresh_token"]
    assert [m["tenant_name"] for m in body["memberships"]] == ["Ana's workspace"]
    me = (
        await client.get("/auth/me", headers={"authorization": f"Bearer {body['access_token']}"})
    ).json()
    assert me["email"] == "ana@example.com" and me["name"] == "Ana Ruiz"

    again = await _google(client, _token(), tenant_name="Ignored for an existing account")
    assert again.status_code == 200
    assert [m["tenant_name"] for m in again.json()["memberships"]] == ["Ana's workspace"]
    # No password yet: password sign-in is refused, not an error.
    login = await client.post(
        "/auth/login", json={"email": "ana@example.com", "password": "anything12"}
    )
    assert login.status_code == 401


@pytest.mark.usefixtures("google_on")
async def test_a_new_account_can_name_its_workspace(client: httpx.AsyncClient) -> None:
    resp = await _google(
        client, _token(sub="s-2", email="bo@example.com", name="Bo"), tenant_name="Greenhouse North"
    )
    assert [m["tenant_name"] for m in resp.json()["memberships"]] == ["Greenhouse North"]


@pytest.mark.usefixtures("google_on")
async def test_links_the_existing_password_account_with_that_email(
    client: httpx.AsyncClient,
) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "Ana@Example.com", "password": "hunter2hunter2", "tenant_name": "Acme"},
    )
    assert reg.status_code == 201
    resp = await _google(client, _token())
    assert resp.status_code == 200
    assert [m["tenant_name"] for m in resp.json()["memberships"]] == ["Acme"]
    # The password still works too.
    login = await client.post(
        "/auth/login", json={"email": "ana@example.com", "password": "hunter2hunter2"}
    )
    assert login.status_code == 200
    # Another Google account can't take that email over.
    other = await _google(client, _token(sub="someone-else"))
    assert other.status_code == 409


@pytest.mark.usefixtures("google_on")
@pytest.mark.parametrize(
    "claims",
    [
        {"aud": "someone-elses-client"},
        {"iss": "https://evil.example.com"},
        {"email_verified": False},
        {"email_verified": None},
        {"email": None},
        {"exp": int(time.time()) - 60},
    ],
)
async def test_refuses_a_token_that_doesnt_check_out(
    client: httpx.AsyncClient, claims: dict[str, Any]
) -> None:
    resp = await _google(client, _token(**claims))
    assert resp.status_code == 401


@pytest.mark.usefixtures("google_on")
async def test_refuses_a_token_signed_by_another_key(client: httpx.AsyncClient) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": WEB,
            "sub": "x",
            "email": "x@example.com",
            "email_verified": True,
            "iat": int(time.time()),
            "exp": int(time.time()) + 600,
        },
        other,
        algorithm="RS256",
    )
    assert (await _google(client, forged)).status_code == 401


class _Outbox:
    def __init__(self) -> None:
        self.messages: list[email_module.EmailMessage] = []

    async def send(self, message: email_module.EmailMessage) -> None:
        self.messages.append(message)


@pytest.mark.usefixtures("google_on")
async def test_joins_an_invitation_with_the_matching_google_account(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    box = _Outbox()
    monkeypatch.setattr(email_module, "_provider", box)
    monkeypatch.setattr(email_module, "DELIVER_INLINE", True)
    owner = (
        await client.post(
            "/auth/register",
            json={
                "email": "owner@example.com",
                "password": "hunter2hunter2",
                "tenant_name": "Farm",
            },
        )
    ).json()
    headers = {
        "authorization": f"Bearer {owner['access_token']}",
        "x-tenant-id": owner["memberships"][0]["tenant_id"],
    }
    assert (
        await client.post(
            "/tenants/invitations",
            json={"email": "ana@example.com", "role": "viewer"},
            headers=headers,
        )
    ).status_code == 201
    token = re.search(r"/invite/([A-Za-z0-9_-]+)", box.messages[-1].body).group(1)  # type: ignore[union-attr]

    wrong = await _google(
        client, _token(sub="s-9", email="not-ana@example.com"), invitation_token=token
    )
    assert wrong.status_code == 403
    ok = await _google(client, _token(), invitation_token=token)
    assert ok.status_code == 200
    # Joined the farm, and no workspace of its own was made.
    assert [(m["tenant_name"], m["role"]) for m in ok.json()["memberships"]] == [("Farm", "viewer")]
