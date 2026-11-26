"""Spanish as a second language (DESIGN.md §11a): each person's saved
language on /auth/me, and the workspace's email language from sign-up."""

import httpx


async def test_locale_follows_browser_until_chosen_and_patch_changes_only_what_is_sent(
    client: httpx.AsyncClient,
) -> None:
    reg = await client.post(
        "/auth/register",
        json={
            "email": "locale-1@example.com",
            "password": "hunter2hunter2",
            "tenant_name": "Viñedo",
            "name": "Ana",
            "locale": "es",
        },
    )
    assert reg.status_code == 201
    body = reg.json()
    tenant_id = body["memberships"][0]["tenant_id"]
    h = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}

    # Signing up from a Spanish browser sets the workspace's email language,
    # not the person's choice: they keep following their browser.
    me = (await client.get("/auth/me", headers=h)).json()
    assert me["locale"] is None
    assert (await client.get("/tenants/current", headers=h)).json()["locale"] == "es"

    resp = await client.patch("/auth/me", json={"locale": "es"}, headers=h)
    assert resp.json()["locale"] == "es"
    assert resp.json()["name"] == "Ana"  # untouched: not sent

    resp = await client.patch("/auth/me", json={"name": "Ana María"}, headers=h)
    assert resp.json() == {**resp.json(), "name": "Ana María", "locale": "es"}

    resp = await client.patch("/auth/me", json={"locale": None}, headers=h)
    assert resp.json()["locale"] is None

    assert (await client.patch("/auth/me", json={"locale": "fr"}, headers=h)).status_code == 422

    resp = await client.patch("/tenants/current", json={"locale": "en"}, headers=h)
    assert resp.json()["locale"] == "en"


async def test_register_without_locale_is_english(client: httpx.AsyncClient) -> None:
    reg = await client.post(
        "/auth/register",
        json={"email": "locale-2@example.com", "password": "hunter2hunter2", "tenant_name": "Bay"},
    )
    body = reg.json()
    h = {
        "authorization": f"Bearer {body['access_token']}",
        "x-tenant-id": body["memberships"][0]["tenant_id"],
    }
    assert (await client.get("/tenants/current", headers=h)).json()["locale"] == "en"
