"""Device catalog entry CRUD.

Every function takes tenant_id explicitly — RLS enforces the tenant boundary
(CLAUDE.md §7). `get_catalog_entry` is also the existence/ownership check
`devices/service.py` reuses when a device is created against a catalog entry.
"""

import json
import uuid
from typing import Any, NamedTuple

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.models import DeviceCatalogEntry
from app.catalog.schemas import RESERVED_METRIC_KEYS
from app.db import add_post_commit_callback
from app.redis import redis_client
from app.shared.slug import slugify

# Signals app.health.service's staleness-threshold derivation (read by
# app.worker's health_monitor_loop) to recompute — a publish-profile edit
# reaches the hot path within seconds, not just at worker restart. Mirrors
# app.rules.service.RULES_INVALIDATE_CHANNEL.
CATALOG_INVALIDATE_CHANNEL = "catalog:invalidate"

# Requests app.worker's manual_command_loop to (re)publish the retained
# {tenant}/{device}/config topic (CLAUDE.md §4) for every device on a catalog
# entry — the API process has no MQTT client of its own (CLAUDE.md: API never
# touches MQTT), so this is a request, not a direct publish, mirroring
# app.commands.service.MANUAL_COMMAND_CHANNEL's shape for the same reason.
CONFIG_PUBLISH_CHANNEL = "catalog:config-publish"


def request_config_publish(session: AsyncSession, entry_id: uuid.UUID) -> None:
    """Requested only after this session's transaction commits (see
    db.add_post_commit_callback's docstring) — used both after a catalog
    entry's metrics change (so existing devices pick up the new publish
    profile) and after a new device is created against an entry (so the
    retained message exists before that device's first-ever connect,
    app.devices.service.create_device).
    """

    async def _publish() -> None:
        await redis_client.publish(
            CONFIG_PUBLISH_CHANNEL, json.dumps({"catalog_entry_id": str(entry_id)})
        )

    add_post_commit_callback(session, _publish)


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


class ReservedMetricKeyError(Exception):
    """Raised when a metric's wire `key` collides with a reserved device-health
    topic segment (`status`/`config`, see catalog/schemas.py's
    RESERVED_METRIC_KEYS) — those 3-segment topics would otherwise be
    indistinguishable from telemetry on the wire (ingestion/service.py).
    """


def _normalize_keyed_items(
    items: list[dict[str, Any]], *, fallback_prefix: str
) -> list[dict[str, Any]]:
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
    normalized = _normalize_keyed_items(metrics, fallback_prefix="metric")
    for item in normalized:
        key = item.get("key")
        if isinstance(key, str) and key.strip().lower() in RESERVED_METRIC_KEYS:
            raise ReservedMetricKeyError(key)
    return normalized


def _normalize_actuators(actuators: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _normalize_keyed_items(actuators, fallback_prefix="actuator")


def _publish_invalidation(session: AsyncSession) -> None:
    """Publish the staleness-threshold reload signal only after this
    session's transaction commits — see db.add_post_commit_callback's
    docstring. app.health.service does a full recompute on any message, so
    the payload is just a marker (mirrors app.rules.service's own
    _publish_invalidation).
    """

    async def _publish() -> None:
        await redis_client.publish(CATALOG_INVALIDATE_CHANNEL, "reload")

    add_post_commit_callback(session, _publish)


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
    _publish_invalidation(session)
    request_config_publish(session, entry.id)
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
    session: AsyncSession,
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
        _publish_invalidation(session)
        request_config_publish(session, entry.id)
    if actuators is not None:
        entry.actuators = _normalize_actuators(actuators)
    if entry_status is not None:
        entry.status = entry_status
    return entry


class CatalogConfigDeviceRow(NamedTuple):
    """One active device on a catalog entry, plus what app.worker needs to
    publish a retained {tenant}/{device}/config message to it — resolved via
    the list_devices_for_catalog_entry SECURITY DEFINER function since the
    worker (unlike an API request) has no tenant context of its own.
    """

    device_id: uuid.UUID
    tenant_slug: str
    device_slug: str
    metrics: list[dict[str, Any]]


async def list_devices_for_config_publish(
    factory: async_sessionmaker[AsyncSession], entry_id: uuid.UUID
) -> list[CatalogConfigDeviceRow]:
    async with factory() as session:
        result = await session.execute(
            text(
                "SELECT device_id, tenant_slug, device_slug, metrics "
                "FROM list_devices_for_catalog_entry(:entry_id)"
            ),
            {"entry_id": str(entry_id)},
        )
        return [CatalogConfigDeviceRow(**row) for row in result.mappings().all()]


async def delete_catalog_entry(
    session: AsyncSession, tenant_id: uuid.UUID, entry_id: uuid.UUID
) -> None:
    entry = await get_catalog_entry(session, tenant_id, entry_id)
    await session.delete(entry)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise CatalogEntryInUseError from exc
