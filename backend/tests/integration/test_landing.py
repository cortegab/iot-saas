"""Integration tests for where people land after signing in
(GET /tenants/current/landing) — against the real FastAPI app and iot_test
Postgres, under RLS.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.devices import service as devices_service


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


async def _landing(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    resp = await client.get("/tenants/current/landing", headers=headers)
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def _complete_setup(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    factory: async_sessionmaker[AsyncSession],
) -> str:
    """A device that has reported, a rule and a dashboard: the four steps."""
    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    created = await client.post(
        "/devices", json={"name": "bay1", "catalog_entry_id": entry}, headers=headers
    )
    assert created.status_code == 201, created.text
    device_id = str(created.json()["device"]["id"])
    async with factory() as session, session.begin():
        await devices_service.touch_last_seen(session, [uuid.UUID(device_id)], datetime.now(UTC))
    rule = await client.post(
        f"/devices/{device_id}/rules",
        json={
            "condition": {
                "kind": "leaf",
                "metric": "temperature",
                "operator": ">",
                "rhs": {"source": "static", "value": 30.0},
            },
            "action": {"type": "actuator_command", "actuator": "fan1", "value": True},
        },
        headers=headers,
    )
    assert rule.status_code == 201, rule.text
    dash = (await client.post("/dashboards", json={"name": "Main"}, headers=headers)).json()
    return str(dash["id"])


async def test_new_workspace_owner_lands_on_get_started(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "land1@example.com", "Land1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    body = await _landing(client, _headers(owner, tenant_id))
    assert body["target"] == "setup"
    assert body["setup_complete"] is False
    assert body["role"] == "owner"


async def test_viewer_in_an_unfinished_workspace_is_welcomed(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "land2@example.com", "Land2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    viewer = await _register(client, "land2v@example.com", "Land2V")
    await client.post(
        "/tenants/members",
        json={"email": "land2v@example.com", "role": "viewer"},
        headers=_headers(owner, tenant_id),
    )
    # Never a checklist they can't act on.
    body = await _landing(client, _headers(viewer, tenant_id))
    assert body["target"] == "welcome"
    assert body["dashboard_ids"] == []


async def test_finished_setup_lands_on_the_default_dashboard(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "land3@example.com", "Land3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _headers(owner, tenant_id)
    first = await _complete_setup(client, headers, app_session_factory)
    second = (await client.post("/dashboards", json={"name": "B"}, headers=headers)).json()["id"]

    body = await _landing(client, headers)
    assert body["target"] == "dashboard"
    assert body["setup_complete"] is True
    assert body["dashboard_id"] is None
    # Most recently changed first, for the page's fallback.
    assert body["dashboard_ids"] == [second, first]

    await client.put(f"/dashboards/{first}/default", headers=headers)
    assert (await _landing(client, headers))["dashboard_id"] == first


async def test_a_member_with_a_dashboard_lands_on_it_while_setup_is_unfinished(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "land4@example.com", "Land4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    viewer = await _register(client, "land4v@example.com", "Land4V")
    await client.post(
        "/tenants/members",
        json={"email": "land4v@example.com", "role": "viewer"},
        headers=_headers(owner, tenant_id),
    )
    viewer_headers = _headers(viewer, tenant_id)
    dash = (await client.post("/dashboards", json={"name": "Mine"}, headers=viewer_headers)).json()

    body = await _landing(client, viewer_headers)
    assert body["target"] == "dashboard"
    assert body["dashboard_ids"] == [dash["id"]]
    # The owner still has setup to finish.
    assert (await _landing(client, _headers(owner, tenant_id)))["target"] == "setup"


async def test_setup_steps_are_read_from_data(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "land5@example.com", "Land5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _headers(owner, tenant_id)
    before = (await client.get("/tenants/current/setup", headers=headers)).json()
    assert before["device"] is False
    assert before["rule"] is False
    assert before["dashboard"] is False
    assert before["complete"] is False
    assert before["first_device_id"] is None

    await _complete_setup(client, headers, app_session_factory)
    after = (await client.get("/tenants/current/setup", headers=headers)).json()
    assert after["template"] and after["device"] and after["rule"] and after["dashboard"]
    assert after["complete"] is True
    assert after["first_device_name"] == "bay1"
    # Inviting is optional: it doesn't hold back "complete".
    assert after["invite"] is False


async def test_dismissing_setup_stops_the_landing_for_the_workspace(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "land6@example.com", "Land6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _headers(owner, tenant_id)
    viewer = await _register(client, "land6v@example.com", "Land6V")
    await client.post(
        "/tenants/members",
        json={"email": "land6v@example.com", "role": "viewer"},
        headers=headers,
    )
    # A viewer can't dismiss it.
    resp = await client.post("/tenants/current/setup/dismiss", headers=_headers(viewer, tenant_id))
    assert resp.status_code == 403

    assert (await client.post("/tenants/current/setup/dismiss", headers=headers)).status_code == 204
    setup = (await client.get("/tenants/current/setup", headers=headers)).json()
    assert setup["dismissed"] is True
    # Someone else joined, so the optional step is done.
    assert setup["invite"] is True
    # No dashboard yet: the owner gets the one-time Welcome instead.
    assert (await _landing(client, headers))["target"] == "welcome"
