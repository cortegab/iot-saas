"""Device CRUD and credential generation.

MQTT username = device.id (globally unique — required so EMQX's HTTP auth
callback can resolve a device from a bare username with no tenant context);
password = random secret, argon2id-hashed via auth.service.hash_secret, shown
once at creation/rotation and never retrievable afterward.
"""

import secrets
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import NamedTuple

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import service as auth_service
from app.catalog import service as catalog_service
from app.db import set_tenant_context
from app.devices.models import Device, DeviceStatus
from app.shared.slug import slugify


class DeviceNotFoundError(Exception):
    pass


class DeviceAuthRecord(NamedTuple):
    """What credential verification needs, resolved by device id alone — used
    when no tenant context exists yet (EMQX auth/authz, the HTTP ingest
    fallback). Backed by a SECURITY DEFINER function (see the
    add_device_auth_lookup_functions migration): the one narrow, auditable
    exception to devices' RLS. Everything else about `devices` stays exactly
    as RLS-protected as it was in d6309384a7aa_create_devices_table.py.
    """

    tenant_id: uuid.UUID
    tenant_slug: str
    device_slug: str
    token_hash: str
    status: str


class DeviceDirectoryRecord(NamedTuple):
    """What topic-based resolution needs — (tenant_slug, device_slug), as
    carried in an MQTT topic, resolved to real ids. Same SECURITY DEFINER
    escape hatch as DeviceAuthRecord, scoped to a different lookup key.
    """

    tenant_id: uuid.UUID
    device_id: uuid.UUID
    status: str


async def _unique_slug(session: AsyncSession, tenant_id: uuid.UUID, name: str) -> str:
    base = slugify(name, fallback="device")
    slug = base
    suffix = 1
    while (
        await session.execute(
            select(Device.id).where(Device.tenant_id == tenant_id, Device.slug == slug)
        )
    ).scalar_one_or_none() is not None:
        suffix += 1
        slug = f"{base}-{suffix}"
    return slug


def _generate_credential_secret() -> str:
    return secrets.token_urlsafe(32)


async def create_device(
    session: AsyncSession, tenant_id: uuid.UUID, name: str, catalog_entry_id: uuid.UUID
) -> tuple[Device, str]:
    """Create a device and return it with its one-time-shown credential secret.

    Raises catalog_service.CatalogEntryNotFoundError if catalog_entry_id
    doesn't belong to this tenant — same existence+ownership check the
    catalog module's own routes use, reused here rather than duplicated.
    """
    await catalog_service.get_catalog_entry(session, tenant_id, catalog_entry_id)

    slug = await _unique_slug(session, tenant_id, name)
    secret = _generate_credential_secret()
    device = Device(
        tenant_id=tenant_id,
        name=name,
        slug=slug,
        catalog_entry_id=catalog_entry_id,
        token_hash=auth_service.hash_secret(secret),
        status=DeviceStatus.ACTIVE.value,
    )
    session.add(device)
    await session.flush()
    # So the retained {tenant}/{device}/config message already exists before
    # this device's first-ever connect (CLAUDE.md §4) — not a side effect of
    # its first message, which would be too late.
    catalog_service.request_config_publish(session, catalog_entry_id)
    return device, secret


async def list_devices(session: AsyncSession, tenant_id: uuid.UUID) -> list[Device]:
    result = await session.execute(select(Device).where(Device.tenant_id == tenant_id))
    return list(result.scalars().all())


async def count_devices_by_catalog_entry(
    session: AsyncSession, tenant_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """Per-catalog-entry device counts, for the Device Types list's "Devices"
    column — one query rather than N, since a tenant can have many types."""
    result = await session.execute(
        select(Device.catalog_entry_id, func.count(Device.id))
        .where(Device.tenant_id == tenant_id)
        .group_by(Device.catalog_entry_id)
    )
    return {catalog_entry_id: count for catalog_entry_id, count in result.all()}


async def get_device(session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID) -> Device:
    result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise DeviceNotFoundError
    return device


async def update_device(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    name: str | None,
    device_status: DeviceStatus | None,
) -> Device:
    device = await get_device(session, tenant_id, device_id)
    if name is not None:
        device.name = name
    if device_status is not None:
        device.status = device_status.value
    await session.flush()
    return device


async def delete_device(session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID) -> None:
    device = await get_device(session, tenant_id, device_id)
    await session.delete(device)
    await session.flush()


async def rotate_credential(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> tuple[Device, str]:
    """Regenerate and overwrite the device's credential, invalidating the
    previous one immediately.
    """
    device = await get_device(session, tenant_id, device_id)
    secret = _generate_credential_secret()
    device.token_hash = auth_service.hash_secret(secret)
    await session.flush()
    return device, secret


async def lookup_device_for_auth(
    session: AsyncSession, device_id: uuid.UUID
) -> DeviceAuthRecord | None:
    result = await session.execute(
        text(
            "SELECT tenant_id, tenant_slug, device_slug, token_hash, status "
            "FROM lookup_device_for_auth(:device_id)"
        ),
        {"device_id": str(device_id)},
    )
    row = result.mappings().first()
    return DeviceAuthRecord(**row) if row is not None else None


async def lookup_device_by_slug(
    session: AsyncSession, tenant_slug: str, device_slug: str
) -> DeviceDirectoryRecord | None:
    result = await session.execute(
        text(
            "SELECT tenant_id, device_id, status "
            "FROM lookup_device_by_slug(:tenant_slug, :device_slug)"
        ),
        {"tenant_slug": tenant_slug, "device_slug": device_slug},
    )
    row = result.mappings().first()
    return DeviceDirectoryRecord(**row) if row is not None else None


async def touch_last_seen(
    session: AsyncSession, device_ids: Sequence[uuid.UUID], seen_at: datetime
) -> None:
    """Batched connection-state update — called once per storage-path flush
    (app.worker's stream_writer_loop), never per-message, so it stays off the
    hot path. Backed by the touch_devices_last_seen SECURITY DEFINER function:
    the worker's session has no tenant context (a flush spans many tenants),
    so a plain UPDATE against RLS-protected `devices` would touch zero rows.
    """
    if not device_ids:
        return
    await session.execute(
        text("SELECT touch_devices_last_seen(:ids, :seen_at)"),
        {"ids": [str(d) for d in device_ids], "seen_at": seen_at},
    )


async def record_status_snapshot(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    *,
    online: bool,
    rssi: int | None,
    battery_pct: int | None,
    uptime_s: int | None,
    fw_version: str | None,
    received_at: datetime,
) -> None:
    """Tier A device-health write — called once per retained
    {tenant}/{device}/status message (app.worker._handle_status), a single
    row, not batched like touch_last_seen above: a status message already
    carries a resolved tenant_id (the same device-directory cache the
    telemetry/ack paths use), so this can set_tenant_context and do a plain
    RLS-scoped UPDATE, the same pattern app.commands.service.record_ack uses
    for a worker-side single-row write — no SECURITY DEFINER function needed.
    `received_at` is the worker's own receive time, never the payload's own
    embedded timestamp (CLAUDE.md §4: an LWT's `online: false` fires at an
    unpredictable moment its payload can't reflect).
    """
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        await session.execute(
            update(Device)
            .where(Device.id == device_id, Device.tenant_id == tenant_id)
            .values(
                last_status_at=received_at,
                last_status_online=online,
                rssi=rssi,
                battery_pct=battery_pct,
                uptime_s=uptime_s,
                fw_version=fw_version,
            )
        )
