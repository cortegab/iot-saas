"""An account in several workspaces gets them in a fixed order: the one it
joined first, first. The sign-in chooser lists them so, and the first is where
a sign-in lands by default, so the order must not depend on the query plan."""

import httpx


async def test_memberships_come_in_the_order_they_were_joined(client: httpx.AsyncClient) -> None:
    owner = (
        await client.post(
            "/auth/register",
            json={
                "email": "order-owner@example.com",
                "password": "hunter2hunter2",
                "tenant_name": "Aaa shared",
            },
        )
    ).json()
    shared = owner["memberships"][0]["tenant_id"]
    me = await client.post(
        "/auth/register",
        json={
            "email": "order-me@example.com",
            "password": "hunter2hunter2",
            "tenant_name": "Zzz mine",
        },
    )
    assert me.status_code == 201
    added = await client.post(
        "/tenants/members",
        json={"email": "order-me@example.com", "role": "viewer"},
        headers={"authorization": f"Bearer {owner['access_token']}", "x-tenant-id": shared},
    )
    assert added.status_code == 201

    for _ in range(3):
        login = await client.post(
            "/auth/login", json={"email": "order-me@example.com", "password": "hunter2hunter2"}
        )
        # Joined first wins over the alphabet: "Zzz mine" was made at sign-up.
        assert [m["tenant_name"] for m in login.json()["memberships"]] == ["Zzz mine", "Aaa shared"]
