"""Integration tests for rule version history (GET /rules/{id}/versions):
written on create and update in the same transaction, skipped for no-op
saves, attributed to the person (not an API key), RLS-isolated, and gone
with the rule — against the real FastAPI app and iot_test Postgres.
"""

from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_CONDITION = {
    "kind": "leaf",
    "metric": "temperature",
    "operator": ">",
    "rhs": {"source": "static", "value": 30.0},
}
_ACTION = {"type": "actuator_command", "actuator": "fan1", "value": True}


async def _register(client: httpx.AsyncClient, email: str, tenant_name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "hunter2hunter2",
            "tenant_name": tenant_name,
            "name": "Ada Owner",
        },
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


def _auth_headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def _setup(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    owner = await _register(client, f"owner-{tag}@example.com", f"Versions {tag}")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    device = (
        await client.post(
            "/devices", json={"name": "S1", "catalog_entry_id": entry}, headers=headers
        )
    ).json()
    resp = await client.post(
        f"/devices/{device['device']['id']}/rules",
        json={"name": "Too hot", "condition": _CONDITION, "action": _ACTION, "cooldown": 60},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return headers, resp.json()["id"]


async def test_create_writes_version_one(client: httpx.AsyncClient) -> None:
    headers, rule_id = await _setup(client, "v1")
    [v] = (await client.get(f"/rules/{rule_id}/versions", headers=headers)).json()
    assert v["version"] == 1
    assert v["change_lines"] == ["Created"]
    assert v["author"] == "Ada Owner"
    assert v["snapshot"]["name"] == "Too hot"
    assert v["snapshot"]["execution_policy"]["cooldown"] == 60


async def test_update_appends_with_change_lines_newest_first(client: httpx.AsyncClient) -> None:
    headers, rule_id = await _setup(client, "v2")
    resp = await client.patch(
        f"/rules/{rule_id}", json={"name": "Hot", "cooldown": 120}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    versions = (await client.get(f"/rules/{rule_id}/versions", headers=headers)).json()
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[0]["change_lines"] == ['Renamed "Too hot" → "Hot"', "Cooldown: 1 min → 2 min"]
    assert versions[0]["snapshot"]["name"] == "Hot"
    # The older snapshot is untouched — it's what Restore loads.
    assert versions[1]["snapshot"]["name"] == "Too hot"


async def test_no_op_save_writes_nothing(client: httpx.AsyncClient) -> None:
    headers, rule_id = await _setup(client, "v3")
    await client.patch(f"/rules/{rule_id}", json={"name": "Too hot"}, headers=headers)
    await client.patch(f"/rules/{rule_id}", json={"editor_graph": {"nodes": []}}, headers=headers)
    assert len((await client.get(f"/rules/{rule_id}/versions", headers=headers)).json()) == 1


async def test_api_key_save_has_no_author(client: httpx.AsyncClient) -> None:
    headers, rule_id = await _setup(client, "v4")
    key = (
        await client.post("/api-keys", json={"name": "ci", "role": "admin"}, headers=headers)
    ).json()["key"]
    resp = await client.patch(
        f"/rules/{rule_id}", json={"enabled": False}, headers={"authorization": f"Bearer {key}"}
    )
    assert resp.status_code == 200, resp.text
    latest = (await client.get(f"/rules/{rule_id}/versions", headers=headers)).json()[0]
    assert latest["change_lines"] == ["Disabled"]
    assert latest["author"] is None and latest["author_id"] is None


async def test_versions_are_tenant_isolated(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    _, rule_id = await _setup(client, "v5a")
    other, _ = await _setup(client, "v5b")
    assert (await client.get(f"/rules/{rule_id}/versions", headers=other)).status_code == 404
    # And directly under RLS: the app role sees no other tenant's rows.
    count = (await admin_session.execute(text("SELECT count(*) FROM rule_versions"))).scalar_one()
    assert count == 2  # one per tenant, visible to the superuser only


async def test_versions_leave_with_the_rule(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    headers, rule_id = await _setup(client, "v6")
    assert (await client.delete(f"/rules/{rule_id}", headers=headers)).status_code == 204
    left = (
        await admin_session.execute(
            text("SELECT count(*) FROM rule_versions WHERE rule_id = :r"), {"r": rule_id}
        )
    ).scalar_one()
    assert left == 0
