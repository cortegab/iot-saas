"""Device CRUD and credential generation.

MQTT username = device.id (globally unique — required so EMQX's HTTP auth
callback can resolve a device from a bare username with no tenant context);
password = random secret, argon2id-hashed via auth.service.hash_secret, shown
once at creation/rotation and never retrievable afterward.
"""

import re
import secrets
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import NamedTuple

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.devices.models import Device, DeviceStatus


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


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return base or "device"


async def _unique_slug(session: AsyncSession, tenant_id: uuid.UUID, name: str) -> str:
    base = _slugify(name)
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
    session: AsyncSession, tenant_id: uuid.UUID, name: str
) -> tuple[Device, str]:
    """Create a device and return it with its one-time-shown credential secret."""
    slug = await _unique_slug(session, tenant_id, name)
    secret = _generate_credential_secret()
    device = Device(
        tenant_id=tenant_id,
        name=name,
        slug=slug,
        token_hash=auth_service.hash_secret(secret),
        status=DeviceStatus.ACTIVE.value,
    )
    session.add(device)
    await session.flush()
    return device, secret


async def list_devices(session: AsyncSession, tenant_id: uuid.UUID) -> list[Device]:
    result = await session.execute(select(Device).where(Device.tenant_id == tenant_id))
    return list(result.scalars().all())


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
