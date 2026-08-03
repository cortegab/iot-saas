"""Telemetry ingestion: topic parsing and the device directory cache that
resolves MQTT topic segments to real tenant/device ids without a DB round
trip on every message. Shared by the MQTT path (app/worker.py) and the HTTP
ingest fallback (app/ingestion/router.py), per CLAUDE.md §6's description of
this module as the "normalization, fork point."
"""

import time
import uuid
from dataclasses import dataclass

import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.devices import service as devices_service
from app.devices.models import DeviceStatus
from app.ingestion.schemas import TelemetryPayload

TELEMETRY_STREAM = "telemetry"

# What the worker subscribes to and what its own EMQX authorization is
# restricted to (see app/ingestion/router.py's emqx_authorize). Three levels —
# {tenant}/{device}/{metric} — deliberately excludes the four-level cmd/state/
# ack topics, which belong to the command service (Phase 3), not ingestion.
TELEMETRY_TOPIC_FILTER = "+/+/+"

_DIRECTORY_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class ParsedTopic:
    tenant_slug: str
    device_slug: str
    metric: str


def parse_topic(topic: str) -> ParsedTopic | None:
    """Split a telemetry topic into its three segments. Returns None on
    anything else — a malformed topic is dropped, never raises (CLAUDE.md
    constraint 11).
    """
    parts = topic.split("/")
    if len(parts) != 3 or not all(parts):
        return None
    tenant_slug, device_slug, metric = parts
    return ParsedTopic(tenant_slug=tenant_slug, device_slug=device_slug, metric=metric)


@dataclass
class _CacheEntry:
    tenant_id: uuid.UUID
    device_id: uuid.UUID
    status: str
    cached_at: float


_directory_cache: dict[tuple[str, str], _CacheEntry] = {}


async def _resolve_device(
    session_factory: async_sessionmaker[AsyncSession],
    tenant_slug: str,
    device_slug: str,
) -> _CacheEntry | None:
    key = (tenant_slug, device_slug)
    cached = _directory_cache.get(key)
    if cached is not None and time.monotonic() - cached.cached_at < _DIRECTORY_CACHE_TTL_SECONDS:
        return cached

    async with session_factory() as session, session.begin():
        record = await devices_service.lookup_device_by_slug(session, tenant_slug, device_slug)

    if record is None:
        _directory_cache.pop(key, None)
        return None

    entry = _CacheEntry(
        tenant_id=record.tenant_id,
        device_id=record.device_id,
        status=record.status,
        cached_at=time.monotonic(),
    )
    _directory_cache[key] = entry
    return entry


async def record_telemetry_direct(
    r: redis.Redis,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    metric: str,
    payload: TelemetryPayload,
) -> None:
    """Push a normalized telemetry entry onto the Redis stream. Used once the
    caller already knows exactly which device this is (topic resolved via the
    cache, or Basic-auth credentials already verified) — no lookup here.
    """
    await r.xadd(
        TELEMETRY_STREAM,
        {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "metric": metric,
            "value": str(payload.value),
            "timestamp": str(payload.timestamp or ""),
        },
    )


async def record_telemetry(
    session_factory: async_sessionmaker[AsyncSession],
    r: redis.Redis,
    parsed_topic: ParsedTopic,
    payload: TelemetryPayload,
) -> bool:
    """Resolve an MQTT topic to a real device and record its telemetry.

    Returns False if the device doesn't exist or isn't active — a message for
    an unknown or disabled device is dropped, never an error.
    """
    entry = await _resolve_device(session_factory, parsed_topic.tenant_slug, parsed_topic.device_slug)
    if entry is None or entry.status != DeviceStatus.ACTIVE.value:
        return False

    await record_telemetry_direct(r, entry.tenant_id, entry.device_id, parsed_topic.metric, payload)
    return True
