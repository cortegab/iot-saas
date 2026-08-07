"""Integration tests for the full auth flow — register, login, refresh (with
reuse-detection), logout — against the real FastAPI app and iot_test Postgres.
"""

import httpx


async def test_register_creates_user_tenant_and_tokens(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/auth/register",
        json={
            "email": "a@example.com",
            "password": "correct horse battery staple",
            "tenant_name": "Acme",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert len(body["memberships"]) == 1
    assert body["memberships"][0]["role"] == "owner"
    assert body["memberships"][0]["tenant_name"] == "Acme"


async def test_register_duplicate_email_conflicts(client: httpx.AsyncClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "correct horse battery staple",
        "tenant_name": "Acme",
    }
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/auth/register", json=payload)
    assert second.status_code == 409


async def test_login_success(client: httpx.AsyncClient) -> None:
    await client.post(
        "/auth/register",
        json={"email": "b@example.com", "password": "hunter2hunter2", "tenant_name": "Beta"},
    )
    resp = await client.post(
        "/auth/login", json={"email": "b@example.com", "password": "hunter2hunter2"}
    )
    assert resp.status_code == 200
    assert resp.json()["access_token"]


async def test_login_wrong_password_rejected(client: httpx.AsyncClient) -> None:
    await client.post(
        "/auth/register",
        json={"email": "c@example.com", "password": "hunter2hunter2", "tenant_name": "Gamma"},
    )
    resp = await client.post(
        "/auth/login", json={"email": "c@example.com", "password": "wrong-password"}
    )
    assert resp.status_code == 401


async def test_login_unknown_email_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "whatever12"}
    )
    assert resp.status_code == 401


async def test_refresh_rotates_token(client: httpx.AsyncClient) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "d@example.com", "password": "hunter2hunter2", "tenant_name": "Delta"},
    )
    old_refresh = reg.json()["refresh_token"]

    resp = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert resp.status_code == 200
    assert resp.json()["refresh_token"] != old_refresh


async def test_refresh_reuse_detected_and_revokes_family(client: httpx.AsyncClient) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "e@example.com", "password": "hunter2hunter2", "tenant_name": "Epsilon"},
    )
    old_refresh = reg.json()["refresh_token"]

    first = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert first.status_code == 200
    new_refresh = first.json()["refresh_token"]

    # Replaying the already-rotated token is treated as a compromise signal.
    replay = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401

    # The whole rotation family — including the token from the first, legitimate
    # rotation — must now be revoked too.
    blocked = await client.post("/auth/refresh", json={"refresh_token": new_refresh})
    assert blocked.status_code == 401


async def test_refresh_garbage_token_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.post("/auth/refresh", json={"refresh_token": "not-a-valid-token"})
    assert resp.status_code == 401


async def test_logout_revokes_refresh_token(client: httpx.AsyncClient) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "f@example.com", "password": "hunter2hunter2", "tenant_name": "Zeta"},
    )
    refresh_token = reg.json()["refresh_token"]

    logout_resp = await client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert logout_resp.status_code == 204

    blocked = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert blocked.status_code == 401


async def test_logout_idempotent_on_garbage_token(client: httpx.AsyncClient) -> None:
    resp = await client.post("/auth/logout", json={"refresh_token": "garbage"})
    assert resp.status_code == 204


async def test_me_returns_current_user(client: httpx.AsyncClient) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "g@example.com", "password": "hunter2hunter2", "tenant_name": "Eta"},
    )
    access_token = reg.json()["access_token"]

    resp = await client.get("/auth/me", headers={"authorization": f"Bearer {access_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "g@example.com"
    assert body["id"]
    assert body["created_at"]


async def test_me_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/auth/me")
    assert resp.status_code == 401

    garbage = await client.get("/auth/me", headers={"authorization": "Bearer garbage"})
    assert garbage.status_code == 401
