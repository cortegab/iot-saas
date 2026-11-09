"""Over-the-air firmware updates (generic firmware 1.0.0+, docs/firmware/ota.md).

The release server (firmware/release.py's output, served at
settings.firmware_url) says what the latest release is and, per chip, where
its app is, its SHA-256 and its signature. This module decides whether a
device can take it over the air and, when an admin asks, sends
{tenant}/{device}/ota through the worker (the API never touches MQTT):

    {"version", "url", "size", "sha256", "signature", "command_id"}

The device checks size, SHA-256 and signature against the public keys built
into its firmware, so the platform can't push anything the release key didn't
sign.
"""

import json
import logging
import re
import time
import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service as catalog_service
from app.config import settings
from app.db import add_post_commit_callback
from app.devices import service as devices_service
from app.devices.models import Device
from app.firmware.schemas import FirmwareStatusResponse, OtaState
from app.redis import redis_client
from app.tenants import service as tenants_service

log = logging.getLogger(__name__)

# app.worker's manual_command_loop publishes these to {tenant}/{device}/ota.
OTA_CHANNEL = "firmware:ota"
# The first firmware that can update itself; older ones need one USB install.
OTA_MIN_VERSION = (1, 0, 0)
MANIFEST_TTL_S = 60.0

_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_manifest_cache: tuple[float, dict[str, Any] | None] = (0.0, None)


class UpdateRefusedError(Exception):
    """The update can't be sent; the message says why, in words."""


def parse_version(v: str | None) -> tuple[int, int, int] | None:
    m = _VERSION.match(v or "")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


async def latest_manifest() -> dict[str, Any] | None:
    """The latest release's manifest, cached for a minute; None when there's
    none or the release server can't be reached."""
    global _manifest_cache
    fetched_at, cached = _manifest_cache
    if time.monotonic() - fetched_at < MANIFEST_TTL_S:
        return cached
    manifest: dict[str, Any] | None = None
    base = settings.firmware_url
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            latest = (await client.get(f"{base}/latest.json")).raise_for_status().json()
            manifest = (await client.get(f"{base}/{latest['manifest']}")).raise_for_status().json()
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        log.warning("firmware manifest unavailable at %s: %s", base, exc)
    _manifest_cache = (time.monotonic(), manifest)
    return manifest


def _chip_for(board: str, manifest: dict[str, Any]) -> str | None:
    """A device's board is a board model id (firmware/boards.json) or, for
    older configs, a chip id."""
    if board in manifest.get("boards", {}):
        return board
    for model in manifest.get("models", []):
        if isinstance(model, dict) and model.get("id") == board:
            chip = model.get("chip")
            return chip if isinstance(chip, str) else None
    return None


async def _hardware_for(session: AsyncSession, device: Device) -> dict[str, Any] | None:
    """The device's own wiring, else its template's, for the generic firmware;
    None for a device that runs its own code."""
    if device.hardware:
        return device.hardware
    if device.catalog_entry_id is None:
        return None
    try:
        entry = await catalog_service.get_catalog_entry(
            session, device.tenant_id, device.catalog_entry_id
        )
    except catalog_service.CatalogEntryNotFoundError:
        return None
    if entry.runs_on != "generic_firmware" or not entry.hardware:
        return None
    return entry.hardware


def _state(device: Device) -> OtaState | None:
    raw = device.ota_state
    return OtaState.model_validate(raw) if isinstance(raw, dict) else None


async def _plan(
    session: AsyncSession, device: Device
) -> tuple[FirmwareStatusResponse, dict[str, Any] | None]:
    """The status, and when an update can go out, the app entry to send."""
    manifest = await latest_manifest()
    current = device.fw_version
    latest = manifest.get("version") if manifest else None
    newer = (parse_version(latest) or (0, 0, 0)) > (parse_version(current) or (0, 0, 0))
    app: dict[str, Any] | None = None
    reason: str | None = None

    hardware = await _hardware_for(session, device)
    if hardware is None:
        reason = "This device runs its own code: update it the way it was installed."
    elif manifest is None or latest is None:
        reason = "No firmware release is published, or the release server can't be reached."
    elif current is None:
        reason = "The device hasn't reported its firmware version yet."
    elif parse_version(current) is None or parse_version(current) < OTA_MIN_VERSION:  # type: ignore[operator]
        reason = "This firmware can't update itself: install 1.0.0 or later over USB once."
    elif not newer:
        reason = "It already runs the latest release."
    elif devices_service.connection_state(device) != "online":
        reason = "The device is offline. It has to be online to update."
    else:
        chip = _chip_for(str(hardware.get("board", "")), manifest)
        board = manifest["boards"].get(chip) if chip else None
        firmware = next(
            (
                p
                for p in (board or {}).get("parts", [])
                if str(p.get("path", "")).endswith("/firmware.bin")
            ),
            None,
        )
        signature = (board or {}).get("app", {}).get("signature")
        if board is None or firmware is None:
            reason = "The latest release has no build for this board."
        elif not signature:
            reason = "The latest release isn't signed, so it can only be installed over USB."
        else:
            app = {
                "url": f"{settings.firmware_url}/{latest}/{firmware['path']}",
                "size": firmware["size"],
                "sha256": firmware["sha256"],
                "signature": signature,
            }

    status = FirmwareStatusResponse(
        current=current,
        latest=latest,
        update_available=hardware is not None and newer,
        can_update=app is not None,
        reason=reason,
        target=device.ota_target,
        requested_at=device.ota_requested_at,
        state=_state(device),
    )
    return status, app


async def firmware_status(session: AsyncSession, device: Device) -> FirmwareStatusResponse:
    status, _ = await _plan(session, device)
    return status


async def request_update(
    session: AsyncSession, tenant_id: uuid.UUID, device: Device, version: str
) -> FirmwareStatusResponse:
    """Sends the latest release to the device. Only the latest: that's what
    the release server describes, and what the device page offers."""
    status, app = await _plan(session, device)
    if app is None:
        raise UpdateRefusedError(status.reason or "This device can't be updated now.")
    if version != status.latest:
        raise UpdateRefusedError(f"Only the latest release ({status.latest}) can be sent.")
    tenant_slug = await tenants_service.get_tenant_slug(session, tenant_id)
    message = json.dumps(
        {
            "tenant_slug": tenant_slug,
            "device_slug": device.slug,
            "payload": {"version": version, **app, "command_id": str(uuid.uuid4())},
        }
    )
    await devices_service.record_ota_request(session, tenant_id, device.id, version)

    async def _publish() -> None:
        await redis_client.publish(OTA_CHANNEL, message)

    add_post_commit_callback(session, _publish)
    await session.refresh(device)
    return await firmware_status(session, device)
