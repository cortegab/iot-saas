"""Integration tests for device catalog entry CRUD, role-gating, RLS
isolation, and the delete-blocked-while-in-use behavior — against the real
FastAPI app and iot_test Postgres.
"""

import json
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


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


async def test_new_tenant_starts_with_one_legacy_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.get("/catalog", headers=headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["is_legacy"] is True


async def test_create_catalog_entry_with_metrics_and_actuators(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={
            "name": "Temperature Sensor v2",
            "metrics": [{"name": "temperature", "unit": "°C", "min": -20.0, "max": 80.0}],
            "actuators": [
                {"name": "fan1", "value_type": "bool", "allowed_values": None},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Temperature Sensor v2"
    assert body["is_legacy"] is False
    assert body["metrics"] == [
        {
            "name": "temperature",
            "key": "temperature",
            "unit": "°C",
            "data_type": "float",
            "decimals": None,
            "min": -20.0,
            "max": 80.0,
            "publish": "periodic",
            "publish_interval_seconds": None,
            "publish_deadband": None,
        }
    ]
    assert body["actuators"] == [
        {
            "name": "fan1",
            "key": "fan1",
            "value_type": "bool",
            "allowed_values": None,
            "on_value": None,
            "off_value": None,
        }
    ]
    assert body["status"] == "active"
    assert body["device_count"] == 0


async def test_create_catalog_entry_auto_derives_key_from_name(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2b@example.com", "Acme2b")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={"name": "ESP32 Temperature", "metrics": [{"name": "Temperature"}]},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["metrics"][0]["key"] == "temperature"


async def test_create_catalog_entry_keeps_explicit_key(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2c@example.com", "Acme2c")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={"name": "Weird", "metrics": [{"name": "Temperature", "key": "Temperature"}]},
        headers=headers,
    )
    assert resp.status_code == 201
    # An explicit key is never re-slugified — the author's exact-case string
    # is preserved as-is (needed to match an already-deployed device's topic).
    assert resp.json()["metrics"][0]["key"] == "Temperature"


async def test_create_catalog_entry_accepts_bool_flag_metric(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2c2@example.com", "Acme2c2")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={
            "name": "Door Sensor",
            "metrics": [{"name": "Door", "data_type": "bool", "unit": None}],
        },
        headers=headers,
    )
    assert resp.status_code == 201
    # An on/off flag metric round-trips as data_type "bool" — still a bare
    # float on the wire, but authoring/display can treat it as two-state.
    assert resp.json()["metrics"][0]["data_type"] == "bool"

    entry_id = resp.json()["id"]
    fetched = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert fetched.json()["metrics"][0]["data_type"] == "bool"


async def test_create_catalog_entry_dedupes_colliding_auto_derived_keys(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner2d@example.com", "Acme2d")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={
            "name": "Duplicate-ish",
            "metrics": [{"name": "Temperature"}, {"name": "temperature"}],
        },
        headers=headers,
    )
    assert resp.status_code == 201
    keys = [m["key"] for m in resp.json()["metrics"]]
    assert keys == ["temperature", "temperature-2"]


async def test_create_catalog_entry_rejects_explicit_duplicate_keys(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner2e@example.com", "Acme2e")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    resp = await client.post(
        "/catalog",
        json={
            "name": "Bad",
            "metrics": [
                {"name": "Temperature", "key": "temp"},
                {"name": "Other", "key": "TEMP"},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 400


async def test_update_catalog_entry_does_not_overwrite_existing_key(
    client: httpx.AsyncClient,
) -> None:
    owner = await _register(client, "owner2f@example.com", "Acme2f")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post(
        "/catalog",
        json={"name": "Original", "metrics": [{"name": "Temperature", "key": "custom-key"}]},
        headers=headers,
    )
    entry_id = created.json()["id"]

    resp = await client.patch(
        f"/catalog/{entry_id}",
        json={"metrics": [{"name": "Temperature Renamed", "key": "custom-key"}]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["metrics"][0]["key"] == "custom-key"


async def test_list_returns_legacy_plus_created(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    await client.post("/catalog", json={"name": "Custom"}, headers=headers)

    resp = await client.get("/catalog", headers=headers)
    names = {e["name"] for e in resp.json()}
    assert names == {"Legacy / Uncategorized", "Custom"}


async def test_update_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post("/catalog", json={"name": "Original"}, headers=headers)
    entry_id = created.json()["id"]

    resp = await client.patch(f"/catalog/{entry_id}", json={"name": "Renamed"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_update_catalog_entry_status(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4b@example.com", "Acme4b")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post("/catalog", json={"name": "Original"}, headers=headers)
    entry_id = created.json()["id"]
    assert created.json()["status"] == "active"

    resp = await client.patch(f"/catalog/{entry_id}", json={"status": "disabled"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "disabled"


async def test_device_count_reflects_devices_using_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4c@example.com", "Acme4c")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]

    get_before = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_before.json()["device_count"] == 0

    await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": entry_id}, headers=headers
    )

    get_after = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_after.json()["device_count"] == 1


async def test_delete_unused_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post("/catalog", json={"name": "Unused"}, headers=headers)
    entry_id = created.json()["id"]

    resp = await client.delete(f"/catalog/{entry_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_catalog_entry_in_use_by_device_returns_409(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]

    await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": entry_id}, headers=headers
    )

    resp = await client.delete(f"/catalog/{entry_id}", headers=headers)
    assert resp.status_code == 409

    # Still there and still usable — a failed delete must not corrupt state.
    get_resp = await client.get(f"/catalog/{entry_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_catalog_tenant_isolation(client: httpx.AsyncClient) -> None:
    owner_a = await _register(client, "ownerA@example.com", "AcmeA")
    headers_a = _auth_headers(owner_a, owner_a["memberships"][0]["tenant_id"])
    entry_a = await client.post("/catalog", json={"name": "OnlyA"}, headers=headers_a)
    entry_a_id = entry_a.json()["id"]

    owner_b = await _register(client, "ownerB@example.com", "AcmeB")
    headers_b = _auth_headers(owner_b, owner_b["memberships"][0]["tenant_id"])

    listing_b = await client.get("/catalog", headers=headers_b)
    assert "OnlyA" not in {e["name"] for e in listing_b.json()}

    get_b = await client.get(f"/catalog/{entry_a_id}", headers=headers_b)
    assert get_b.status_code == 404


async def test_viewer_can_list_but_not_create_catalog_entry(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    owner_headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])

    viewer = await _register(client, "viewer7@example.com", "ViewerOwnTenant7")
    await client.post(
        "/tenants/members",
        json={"email": "viewer7@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, owner["memberships"][0]["tenant_id"])

    list_resp = await client.get("/catalog", headers=viewer_headers)
    assert list_resp.status_code == 200

    create_resp = await client.post("/catalog", json={"name": "Nope"}, headers=viewer_headers)
    assert create_resp.status_code == 403


# ---- demo G: key format, disabled templates, usage counts -------------------


async def test_invalid_explicit_keys_are_refused(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "keys1@example.com", "Keys1")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    for bad in ["a/b", "temp+", "#", "with space", "$sys", "dot.ted", "x" * 65]:
        resp = await client.post(
            "/catalog", json={"name": "T", "metrics": [{"name": "m", "key": bad}]}, headers=headers
        )
        assert resp.status_code == 400, bad
        assert "isn't valid" in resp.json()["detail"]
    # Actuator keys are checked too.
    resp = await client.post(
        "/catalog",
        json={"name": "T", "actuators": [{"name": "Fan", "key": "fan/1"}]},
        headers=headers,
    )
    assert resp.status_code == 400
    # Kebab-case, snake_case and an already-deployed device's mixed case are fine.
    ok = await client.post(
        "/catalog",
        json={
            "name": "T",
            "metrics": [
                {"name": "a", "key": "soil-moisture"},
                {"name": "b", "key": "air_temp"},
                {"name": "c", "key": "Temp2"},
            ],
        },
        headers=headers,
    )
    assert ok.status_code == 201


async def test_stored_legacy_key_is_grandfathered_on_update(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "keys3@example.com", "Keys3")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await client.post(
        "/catalog", json={"name": "Old", "metrics": [{"name": "t", "key": "t"}]}, headers=headers
    )
    entry_id = created.json()["id"]
    # A key written before validation existed.
    await admin_session.execute(
        text("UPDATE device_catalog_entries SET metrics = CAST(:m AS jsonb) WHERE id = :id"),
        {"m": json.dumps([{"name": "Temp", "key": "room temp"}]), "id": entry_id},
    )
    await admin_session.commit()

    keep = await client.patch(
        f"/catalog/{entry_id}",
        json={"name": "Old renamed", "metrics": [{"name": "Temp", "key": "room temp"}]},
        headers=headers,
    )
    assert keep.status_code == 200, keep.text

    new_bad = await client.patch(
        f"/catalog/{entry_id}",
        json={"metrics": [{"name": "Temp", "key": "room temp"}, {"name": "x", "key": "X/Y"}]},
        headers=headers,
    )
    assert new_bad.status_code == 400


async def test_disabled_template_cannot_be_used_for_new_devices(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "keys4@example.com", "Keys4")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry_id = (await client.post("/catalog", json={"name": "Retired"}, headers=headers)).json()[
        "id"
    ]
    await client.patch(f"/catalog/{entry_id}", json={"status": "disabled"}, headers=headers)

    resp = await client.post(
        "/devices", json={"name": "New", "catalog_entry_id": entry_id}, headers=headers
    )
    assert resp.status_code == 409
    assert "disabled" in resp.json()["detail"]

    await client.patch(f"/catalog/{entry_id}", json={"status": "active"}, headers=headers)
    resp = await client.post(
        "/devices", json={"name": "New", "catalog_entry_id": entry_id}, headers=headers
    )
    assert resp.status_code == 201


async def test_usage_counts_rules_and_widgets_per_key(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "keys5@example.com", "Keys5")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    entry = await client.post(
        "/catalog",
        json={
            "name": "Climate",
            "metrics": [
                {"name": "Temperature", "key": "temperature"},
                {"name": "Humidity", "key": "humidity"},
            ],
            "actuators": [{"name": "Fan", "key": "fan1"}],
        },
        headers=headers,
    )
    entry_id = entry.json()["id"]
    device = await client.post(
        "/devices", json={"name": "bay1", "catalog_entry_id": entry_id}, headers=headers
    )
    device_id = device.json()["device"]["id"]

    rule = await client.post(
        "/rules",
        json={
            "name": "Cool bay 1",
            "condition": {
                "kind": "leaf",
                "device_id": device_id,
                "metric": "temperature",
                "operator": ">",
                "rhs": {"source": "static", "value": 27.0},
            },
            "execution_policy": {"strategy": "edge", "for_duration": 10, "cooldown": 60},
            "actions": [
                {
                    "type": "actuator_command",
                    "device_id": device_id,
                    "actuator": "fan1",
                    "value": True,
                }
            ],
        },
        headers=headers,
    )
    assert rule.status_code == 201, rule.text

    dash = await client.post("/dashboards", json={"name": "Overview"}, headers=headers)
    layout = [
        {
            "id": "w1",
            "type": "value_card",
            "x": 0,
            "y": 0,
            "w": 3,
            "h": 2,
            "device_id": device_id,
            "metric": "temperature",
        },
        {
            "id": "w2",
            "type": "trend_chart",
            "x": 3,
            "y": 0,
            "w": 6,
            "h": 2,
            "device_id": device_id,
            "metric": "temperature",
        },
        {
            "id": "w3",
            "type": "actuator_control",
            "x": 0,
            "y": 2,
            "w": 4,
            "h": 2,
            "device_id": device_id,
        },
    ]
    patched = await client.patch(
        f"/dashboards/{dash.json()['id']}", json={"layout": layout}, headers=headers
    )
    assert patched.status_code == 200, patched.text

    usage = await client.get(f"/catalog/{entry_id}/usage", headers=headers)
    assert usage.status_code == 200
    body = usage.json()
    assert body["devices"] == 1
    assert body["metrics"]["temperature"] == {"rules": 1, "widgets": 2}
    assert body["metrics"]["humidity"] == {"rules": 0, "widgets": 0}
    assert body["actuators"]["fan1"] == {"rules": 1, "widgets": 1}
