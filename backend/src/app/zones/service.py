"""Zone CRUD. Every function takes tenant_id explicitly — RLS enforces the
tenant boundary (CLAUDE.md §7). Device counts come from devices.service
(module discipline, CLAUDE.md §6).
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.zones.models import Zone


class ZoneNotFoundError(Exception):
    pass


class ZoneNameTakenError(Exception):
    """Another zone in the tenant already has this name (case-insensitive)."""


class ZoneInUseError(Exception):
    """Raised when deleting a zone devices are still assigned to."""

    def __init__(self, device_count: int) -> None:
        super().__init__(device_count)
        self.device_count = device_count


async def _assert_name_free(
    session: AsyncSession, tenant_id: uuid.UUID, name: str, exclude: uuid.UUID | None = None
) -> None:
    query = select(Zone.id).where(
        Zone.tenant_id == tenant_id, func.lower(Zone.name) == name.strip().lower()
    )
    if exclude is not None:
        query = query.where(Zone.id != exclude)
    if (await session.execute(query)).first() is not None:
        raise ZoneNameTakenError(name)


async def list_zones(session: AsyncSession, tenant_id: uuid.UUID) -> list[Zone]:
    result = await session.execute(
        select(Zone).where(Zone.tenant_id == tenant_id).order_by(func.lower(Zone.name))
    )
    return list(result.scalars().all())


async def get_zone(session: AsyncSession, tenant_id: uuid.UUID, zone_id: uuid.UUID) -> Zone:
    result = await session.execute(
        select(Zone).where(Zone.tenant_id == tenant_id, Zone.id == zone_id)
    )
    zone = result.scalar_one_or_none()
    if zone is None:
        raise ZoneNotFoundError
    return zone


async def create_zone(
    session: AsyncSession, tenant_id: uuid.UUID, name: str, notes: str | None
) -> Zone:
    await _assert_name_free(session, tenant_id, name)
    zone = Zone(tenant_id=tenant_id, name=name.strip(), notes=(notes or "").strip() or None)
    session.add(zone)
    await session.flush()
    return zone


async def update_zone(
    session: AsyncSession, zone: Zone, name: str | None, notes: str | None, notes_set: bool
) -> Zone:
    if name is not None:
        await _assert_name_free(session, zone.tenant_id, name, exclude=zone.id)
        zone.name = name.strip()
    if notes_set:
        zone.notes = (notes or "").strip() or None
    await session.flush()
    return zone


async def delete_zone(session: AsyncSession, zone: Zone) -> None:
    # Local import: devices.service imports this module to validate zone_id.
    from app.devices import service as devices_service

    count = (await devices_service.count_devices_by_zone(session, zone.tenant_id)).get(zone.id, 0)
    if count:
        raise ZoneInUseError(count)
    await session.delete(zone)
    await session.flush()
