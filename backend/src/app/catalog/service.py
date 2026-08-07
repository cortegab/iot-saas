"""Device catalog entry CRUD.

Every function takes tenant_id explicitly — RLS enforces the tenant boundary
(CLAUDE.md §7). `get_catalog_entry` is also the existence/ownership check
`devices/service.py` reuses when a device is created against a catalog entry.
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import DeviceCatalogEntry


class CatalogEntryNotFoundError(Exception):
    pass


class CatalogEntryInUseError(Exception):
    """Raised when deleting a catalog entry that devices still reference —
    devices.catalog_entry_id has no ON DELETE clause, so Postgres's default
    RESTRICT trips an IntegrityError; this translates it into a clean 409
    rather than leaking a raw FK-violation message.
    """


async def create_catalog_entry(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    name: str,
    metrics: list[dict[str, Any]],
    actuators: list[dict[str, Any]],
    is_legacy: bool = False,
) -> DeviceCatalogEntry:
    entry = DeviceCatalogEntry(
        tenant_id=tenant_id, name=name, metrics=metrics, actuators=actuators, is_legacy=is_legacy
    )
    session.add(entry)
    await session.flush()
    return entry


async def list_catalog_entries(
    session: AsyncSession, tenant_id: uuid.UUID
) -> list[DeviceCatalogEntry]:
    result = await session.execute(
        select(DeviceCatalogEntry)
        .where(DeviceCatalogEntry.tenant_id == tenant_id)
        .order_by(DeviceCatalogEntry.created_at)
    )
    return list(result.scalars().all())


async def get_catalog_entry(
    session: AsyncSession, tenant_id: uuid.UUID, entry_id: uuid.UUID
) -> DeviceCatalogEntry:
    result = await session.execute(
        select(DeviceCatalogEntry).where(
            DeviceCatalogEntry.tenant_id == tenant_id, DeviceCatalogEntry.id == entry_id
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise CatalogEntryNotFoundError
    return entry


async def update_catalog_entry(
    entry: DeviceCatalogEntry,
    name: str | None,
    metrics: list[dict[str, Any]] | None,
    actuators: list[dict[str, Any]] | None,
) -> DeviceCatalogEntry:
    if name is not None:
        entry.name = name
    if metrics is not None:
        entry.metrics = metrics
    if actuators is not None:
        entry.actuators = actuators
    return entry


async def delete_catalog_entry(
    session: AsyncSession, tenant_id: uuid.UUID, entry_id: uuid.UUID
) -> None:
    entry = await get_catalog_entry(session, tenant_id, entry_id)
    await session.delete(entry)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise CatalogEntryInUseError from exc
