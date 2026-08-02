"""Device CRUD and credential generation.

MQTT username = device slug (unique per tenant); password = random secret,
argon2id-hashed via auth.service.hash_secret, shown once at creation/rotation
and never retrievable afterward.
"""

import re
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.devices.models import Device, DeviceStatus


class DeviceNotFoundError(Exception):
    pass


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
