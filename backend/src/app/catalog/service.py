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
from app.shared.slug import slugify


class CatalogEntryNotFoundError(Exception):
    pass


class CatalogEntryInUseError(Exception):
    """Raised when deleting a catalog entry that devices still reference —
    devices.catalog_entry_id has no ON DELETE clause, so Postgres's default
    RESTRICT trips an IntegrityError; this translates it into a clean 409
    rather than leaking a raw FK-violation message.
    """


class DuplicateKeyError(Exception):
    """Raised when two metrics (or two actuators) in the same catalog entry
    explicitly declare the same wire `key` (case-insensitively) — an
    author-supplied collision. Refused rather than silently renamed, since
    the author set it on purpose.
    """


def _normalize_keyed_items(items: list[dict[str, Any]], *, fallback_prefix: str) -> list[dict[str, Any]]:
    """Fill in a blank `key` from a slugified `name`, and make sure every key
    in the list is unique (case-insensitively — `key` is the MQTT topic
    segment / wire identifier, and "Temperature" vs "temperature" colliding
    is exactly the bug this normalization exists to prevent, see CLAUDE.md
    §4's device contract). An explicit author-supplied collision is a hard
    error; an auto-derived collision is silently disambiguated with a
    numeric suffix, the same pattern devices/tenants use for slug collisions.
    """
    seen_explicit: set[str] = set()
    for item in items:
        key = item.get("key")
        if key:
            lowered = key.strip().lower()
            if lowered in seen_explicit:
                raise DuplicateKeyError(key)
            seen_explicit.add(lowered)

    used = set(seen_explicit)
    normalized: list[dict[str, Any]] = []
    for i, raw_item in enumerate(items):
        item = dict(raw_item)
        key = item.get("key")
        if not key:
            base = slugify(item.get("name") or "", fallback=f"{fallback_prefix}-{i + 1}")
            candidate = base
            suffix = 1
            while candidate.lower() in used:
                suffix += 1
                candidate = f"{base}-{suffix}"
            item["key"] = candidate
            used.add(candidate.lower())
        normalized.append(item)
    return normalized


def _normalize_metrics(metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _normalize_keyed_items(metrics, fallback_prefix="metric")


def _normalize_actuators(actuators: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _normalize_keyed_items(actuators, fallback_prefix="actuator")


async def create_catalog_entry(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    name: str,
    metrics: list[dict[str, Any]],
    actuators: list[dict[str, Any]],
    is_legacy: bool = False,
) -> DeviceCatalogEntry:
    entry = DeviceCatalogEntry(
        tenant_id=tenant_id,
        name=name,
        metrics=_normalize_metrics(metrics),
        actuators=_normalize_actuators(actuators),
        is_legacy=is_legacy,
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
    entry_status: str | None,
) -> DeviceCatalogEntry:
    if name is not None:
        entry.name = name
    if metrics is not None:
        entry.metrics = _normalize_metrics(metrics)
    if actuators is not None:
        entry.actuators = _normalize_actuators(actuators)
    if entry_status is not None:
        entry.status = entry_status
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
