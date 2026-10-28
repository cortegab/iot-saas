"""Integration tests for GET /tenants/current/counts: the sidebar's counts in
one request — scoped to the workspace (RLS), dashboards to the person, and
members / API keys only for admins — against the real app and iot_test.
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


async def _owner(client: httpx.AsyncClient, tag: str) -> dict[str, str]:
    owner = await _register(client, f"owner-{tag}@example.com", f"WS {tag}")
    return _auth_headers(owner, owner["memberships"][0]["tenant_id"])


async def _stock(client: httpx.AsyncClient, headers: dict[str, str], tag: str) -> None:
    """One template, two devices, one zone, one dashboard, one API key."""
    entry = await client.post(
        "/catalog",
        json={
            "name": f"Tpl {tag}",
            "runs_on": "own_code",
            "metrics": [{"name": "Temp", "key": "temp"}],
        },
        headers=headers,
    )
    assert entry.status_code == 201, entry.text
    for n in (1, 2):
        dev = await client.post(
            "/devices",
            json={"name": f"Dev {tag} {n}", "catalog_entry_id": entry.json()["id"]},
            headers=headers,
        )
        assert dev.status_code == 201, dev.text
    assert (
        await client.post("/zones", json={"name": f"Zone {tag}"}, headers=headers)
    ).status_code == 201
    assert (
        await client.post("/dashboards", json={"name": f"Dash {tag}"}, headers=headers)
    ).status_code == 201
    key = await client.post(
        "/api-keys", json={"name": f"Key {tag}", "role": "viewer"}, headers=headers
    )
    assert key.status_code == 201, key.text


async def test_counts_match_the_workspace_and_ignore_others(client: httpx.AsyncClient) -> None:
    mine = await _owner(client, "nc1")
    theirs = await _owner(client, "nc2")
    await _stock(client, mine, "nc1")
    await _stock(client, theirs, "nc2")
    await _stock(client, theirs, "nc2b")

    resp = await client.get("/tenants/current/counts", headers=mine)
    assert resp.status_code == 200
    counts = resp.json()
    # The same numbers the sidebar used to get from the full lists.
    lists = {
        "devices": "/devices",
        "rules": "/rules",
        "templates": "/catalog",
        "dashboards": "/dashboards",
        "zones": "/zones",
        "members": "/tenants/members",
    }
    for field, path in lists.items():
        assert counts[field] == len((await client.get(path, headers=mine)).json()), field
    keys = (await client.get("/api-keys", headers=mine)).json()
    assert counts["api_keys"] == len([k for k in keys if k["revoked_at"] is None])
    # …and only this workspace's: two devices, one zone, one dashboard, one key.
    assert counts["devices"] == 2
    assert counts["zones"] == 1
    assert counts["dashboards"] == 1
    assert counts["api_keys"] == 1


async def test_viewer_gets_no_member_or_key_counts_and_only_their_dashboards(
    client: httpx.AsyncClient,
) -> None:
    owner = await _owner(client, "nc3")
    await _stock(client, owner, "nc3")
    viewer = await _register(client, "viewer-nc3@example.com", "Own nc3")
    added = await client.post(
        "/tenants/members",
        json={"email": "viewer-nc3@example.com", "role": "viewer"},
        headers=owner,
    )
    assert added.status_code == 201
    viewer_headers = _auth_headers(viewer, owner["x-tenant-id"])

    body = (await client.get("/tenants/current/counts", headers=viewer_headers)).json()
    assert body["devices"] == 2
    assert body["dashboards"] == 0  # the owner's dashboard is theirs alone
    assert body["members"] is None
    assert body["api_keys"] is None
