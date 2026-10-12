"""Integration tests for hardware bindings (the generic firmware's wiring) on
catalog entries and devices — against the real FastAPI app and iot_test
Postgres.
"""

from typing import Any

import httpx

DOOR_INPUT = {
    "driver": "digital_in",
    "pins": {"pin": 13},
    "params": {"pull": "up", "invert": True},
    "channels": {"value": "door"},
}
FAN_OUTPUT = {"driver": "relay", "pins": {"pin": 23}, "params": {}, "channels": {"value": "fan1"}}
HARDWARE = {"board": "esp32", "i2c": None, "inputs": [DOOR_INPUT], "outputs": [FAN_OUTPUT]}


async def _headers(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": email.split("@")[0]},
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    return {
        "authorization": f"Bearer {body['access_token']}",
        "x-tenant-id": body["memberships"][0]["tenant_id"],
    }


async def _template(
    client: httpx.AsyncClient, headers: dict[str, str], **extra: Any
) -> dict[str, Any]:
    resp = await client.post(
        "/catalog",
        json={
            "name": "Door panel",
            "metrics": [
                {"name": "Door", "key": "door", "data_type": "bool"},
                {"name": "Level", "key": "level"},
            ],
            "actuators": [{"name": "Fan", "key": "fan1"}],
            **extra,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


async def test_template_hardware_round_trips(client: httpx.AsyncClient) -> None:
    headers = await _headers(client, "hw1@example.com")
    created = await _template(client, headers, hardware=HARDWARE)
    assert created["hardware"] == HARDWARE

    fetched = await client.get(f"/catalog/{created['id']}", headers=headers)
    assert fetched.json()["hardware"] == HARDWARE


async def test_template_without_hardware_has_none(client: httpx.AsyncClient) -> None:
    headers = await _headers(client, "hw2@example.com")
    created = await _template(client, headers)
    assert created["hardware"] is None


async def test_template_hardware_must_feed_declared_keys(client: httpx.AsyncClient) -> None:
    headers = await _headers(client, "hw3@example.com")
    bad = {**HARDWARE, "inputs": [{**DOOR_INPUT, "channels": {"value": "humidity"}}]}
    resp = await client.post(
        "/catalog",
        json={"name": "Bad", "metrics": [{"name": "Door", "key": "door"}], "hardware": bad},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "humidity" in resp.json()["detail"]


async def test_removing_a_wired_metric_needs_the_wiring_fixed_too(
    client: httpx.AsyncClient,
) -> None:
    headers = await _headers(client, "hw4@example.com")
    created = await _template(client, headers, hardware=HARDWARE)
    only_level = [{"name": "Level", "key": "level"}]

    resp = await client.patch(
        f"/catalog/{created['id']}", json={"metrics": only_level}, headers=headers
    )
    assert resp.status_code == 400
    assert "door" in resp.json()["detail"]

    # The same save with the wiring updated goes through.
    rewired = {**HARDWARE, "inputs": []}
    resp = await client.patch(
        f"/catalog/{created['id']}",
        json={"metrics": only_level, "hardware": rewired},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["hardware"]["inputs"] == []


async def test_template_hardware_can_be_cleared(client: httpx.AsyncClient) -> None:
    headers = await _headers(client, "hw5@example.com")
    created = await _template(client, headers, hardware=HARDWARE)
    resp = await client.patch(f"/catalog/{created['id']}", json={"hardware": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["hardware"] is None
    # Omitting it leaves it alone.
    resp = await client.patch(
        f"/catalog/{created['id']}", json={"name": "Renamed"}, headers=headers
    )
    assert resp.json()["hardware"] is None


async def test_device_own_hardware(client: httpx.AsyncClient) -> None:
    headers = await _headers(client, "hw6@example.com")
    template = await _template(client, headers, hardware=HARDWARE)
    resp = await client.post(
        "/devices", json={"name": "Panel 1", "catalog_entry_id": template["id"]}, headers=headers
    )
    device = resp.json()["device"]
    assert device["hardware"] is None  # the template's applies

    moved = {**HARDWARE, "inputs": [{**DOOR_INPUT, "pins": {"pin": 14}}]}
    resp = await client.patch(f"/devices/{device['id']}", json={"hardware": moved}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["hardware"]["inputs"][0]["pins"] == {"pin": 14}

    # Checked against the device's template.
    bad = {**HARDWARE, "outputs": [{**FAN_OUTPUT, "channels": {"value": "pump"}}]}
    resp = await client.patch(f"/devices/{device['id']}", json={"hardware": bad}, headers=headers)
    assert resp.status_code == 400
    assert "pump" in resp.json()["detail"]

    resp = await client.patch(f"/devices/{device['id']}", json={"hardware": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["hardware"] is None
