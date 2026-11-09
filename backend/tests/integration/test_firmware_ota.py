"""Over-the-air firmware updates (app.firmware): whether a device can take the
latest release, and what an admin's update request sends."""

import json
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.firmware import service as firmware_service
from app.ingestion.service import ParsedTopic

HARDWARE = {
    "board": "esp32-devkit-30",
    "i2c": None,
    "inputs": [],
    "outputs": [
        {"driver": "relay", "pins": {"pin": 23}, "params": {}, "channels": {"value": "fan1"}}
    ],
}


def manifest(version: str = "1.0.1", signed: bool = True) -> dict[str, Any]:
    app: dict[str, Any] = {"offset": 65536, "size": 1966080, "used": 1441315}
    if signed:
        app["signature"] = "MEUCIQ..."
    return {
        "version": version,
        "boards": {
            "esp32": {
                "chip": "ESP32",
                "parts": [
                    {"path": "esp32/bootloader.bin", "offset": 4096, "size": 23520, "sha256": "aa"},
                    {
                        "path": "esp32/firmware.bin",
                        "offset": 65536,
                        "size": 1441315,
                        "sha256": "bb" * 32,
                    },
                ],
                "app": app,
            }
        },
        "models": [{"id": "esp32-devkit-30", "chip": "esp32"}],
    }


@pytest.fixture
def release(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """The release server's latest manifest; tests change it in place."""
    current: dict[str, Any] = {"manifest": manifest()}

    async def _latest() -> dict[str, Any] | None:
        m: dict[str, Any] | None = current["manifest"]
        return m

    monkeypatch.setattr(firmware_service, "latest_manifest", _latest)
    return current


async def _setup(
    client: httpx.AsyncClient,
    factory: async_sessionmaker[AsyncSession],
    email: str,
    fw_version: str | None = "1.0.0",
) -> tuple[dict[str, str], dict[str, Any]]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": email.split("@")[0]},
    )
    body = resp.json()
    headers = {
        "authorization": f"Bearer {body['access_token']}",
        "x-tenant-id": body["memberships"][0]["tenant_id"],
    }
    template = await client.post(
        "/catalog",
        json={
            "name": "Fan box",
            "actuators": [{"name": "Fan", "key": "fan1"}],
            "hardware": HARDWARE,
        },
        headers=headers,
    )
    assert template.status_code == 201, template.text
    created = await client.post(
        "/devices", json={"name": "Box", "catalog_entry_id": template.json()["id"]}, headers=headers
    )
    device = created.json()
    if fw_version is not None:
        parsed = ParsedTopic(
            tenant_slug=device["tenant_slug"], device_slug=device["device"]["slug"], metric="status"
        )
        payload = {"online": True, "fw_version": fw_version, "boot_count": 1, "faults": []}
        await worker._handle_status(factory, AsyncMock(), parsed, json.dumps(payload).encode())
    return headers, device


async def test_status_offers_the_latest_signed_release(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    release: dict[str, Any],
) -> None:
    headers, device = await _setup(client, app_session_factory, "ota1@example.com")
    resp = await client.get(f"/devices/{device['device']['id']}/firmware", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["current"] == "1.0.0"
    assert body["latest"] == "1.0.1"
    assert body["update_available"] is True
    assert body["can_update"] is True
    assert body["reason"] is None


@pytest.mark.parametrize(
    ("fw_version", "release_manifest", "reason"),
    [
        ("0.15.1", manifest(), "install 1.0.0 or later over USB"),
        ("1.0.1", manifest(), "already runs the latest"),
        ("1.0.0", manifest(signed=False), "isn't signed"),
        ("1.0.0", None, "No firmware release"),
        (None, manifest(), "hasn't reported"),
    ],
)
async def test_status_says_why_it_cant_update(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    release: dict[str, Any],
    fw_version: str | None,
    release_manifest: dict[str, Any] | None,
    reason: str,
) -> None:
    release["manifest"] = release_manifest
    email = f"ota-why-{fw_version}-{release_manifest is not None}-{bool(release_manifest and release_manifest['boards']['esp32']['app'].get('signature'))}@example.com"
    headers, device = await _setup(client, app_session_factory, email, fw_version=fw_version)
    body = (await client.get(f"/devices/{device['device']['id']}/firmware", headers=headers)).json()
    assert body["can_update"] is False
    assert reason in body["reason"]


async def test_update_request_is_published_for_the_worker(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    release: dict[str, Any],
    _mock_redis_publish: AsyncMock,
) -> None:
    headers, device = await _setup(client, app_session_factory, "ota2@example.com")
    device_id = device["device"]["id"]

    # Only the latest release.
    resp = await client.post(
        f"/devices/{device_id}/firmware/update", json={"version": "1.0.5"}, headers=headers
    )
    assert resp.status_code == 409

    resp = await client.post(
        f"/devices/{device_id}/firmware/update", json={"version": "1.0.1"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["target"] == "1.0.1"

    calls = [
        c for c in _mock_redis_publish.call_args_list if c.args[0] == firmware_service.OTA_CHANNEL
    ]
    assert len(calls) == 1
    request = json.loads(calls[0].args[1])
    assert request["device_slug"] == device["device"]["slug"]
    sent = request["payload"]
    assert sent["version"] == "1.0.1"
    assert sent["url"].endswith("/1.0.1/esp32/firmware.bin")
    assert sent["size"] == 1441315
    assert sent["sha256"] == "bb" * 32
    assert sent["signature"] == "MEUCIQ..."
    assert sent["command_id"]

    # The worker publishes it on the device's ota topic, QoS 1, not retained.
    mqtt = AsyncMock()
    await worker._handle_ota_request(mqtt, calls[0].args[1])
    topic, payload = mqtt.publish.call_args.args
    assert topic == f"{device['tenant_slug']}/{device['device']['slug']}/ota"
    assert json.loads(payload) == sent
    assert mqtt.publish.call_args.kwargs == {"qos": 1}


async def test_a_failed_update_is_reported_and_alerted(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    release: dict[str, Any],
) -> None:
    headers, device = await _setup(client, app_session_factory, "ota3@example.com")
    parsed = ParsedTopic(
        tenant_slug=device["tenant_slug"], device_slug=device["device"]["slug"], metric="status"
    )
    report = {
        "online": True,
        "fw_version": "1.0.0",
        "boot_count": 1,
        "faults": [],
        "ota": {"version": "1.0.1", "state": "failed", "error": "the signature doesn't match"},
    }
    for _ in range(2):  # reported twice, alerted once
        await worker._handle_status(
            app_session_factory, AsyncMock(), parsed, json.dumps(report).encode()
        )
    body = (await client.get(f"/devices/{device['device']['id']}/firmware", headers=headers)).json()
    assert body["state"] == {
        "version": "1.0.1",
        "state": "failed",
        "error": "the signature doesn't match",
    }
    alerts = [
        n["message"]
        for n in (await client.get("/notifications", headers=headers)).json()
        if n["kind"] == "device_health"
    ]
    assert alerts == [f"{device['device']['slug']}: update to 1.0.1 failed"]


async def test_update_needs_a_signed_in_user(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    release: dict[str, Any],
) -> None:
    """Nothing is sent without a valid session (the route also requires the
    Admin role, require_role(TenantRole.ADMIN), like rotate-credential)."""
    headers, device = await _setup(client, app_session_factory, "ota4@example.com")
    resp = await client.post(
        f"/devices/{device['device']['id']}/firmware/update",
        json={"version": "1.0.1"},
        headers={"authorization": "Bearer nope", "x-tenant-id": headers["x-tenant-id"]},
    )
    assert resp.status_code in (401, 403)
