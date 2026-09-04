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
from app.devices.service import DeviceDirectoryRecord
from app.ingestion.schemas import TelemetryPayload
from app.realtime import service as realtime_service

TELEMETRY_STREAM = "telemetry"

# What the worker subscribes to and what its own EMQX authorization is
# restricted to (see app/ingestion/router.py's emqx_authorize). Three levels —
# {tenant}/{device}/{metric}.
TELEMETRY_TOPIC_FILTER = "+/+/+"

# The four-level ack topic {tenant}/{device}/ack/{actuator} (device -> platform,
# CLAUDE.md §4) — the worker also subscribes to this (app/worker.py) so
# app/commands/service.py can mark a command acknowledged.
ACK_TOPIC_FILTER = "+/+/ack/+"

# Reserved wire-format metric segment for the device-health snapshot topic
# {tenant}/{device}/status (CLAUDE.md §4) — same 3-segment shape as telemetry,
# so it rides the existing TELEMETRY_TOPIC_FILTER subscription; app.worker's
# handle_message branches on this before treating a message as telemetry.
# catalog/service.py rejects a tenant-authored metric key that collides with
# this (or "config") at write time.
RESERVED_METRIC_STATUS = "status"

_DIRECTORY_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class ParsedTopic:
    tenant_slug: str
    device_slug: str
    metric: str


@dataclass(frozen=True)
class ParsedAckTopic:
    tenant_slug: str
    device_slug: str
    actuator: str


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


def parse_ack_topic(topic: str) -> ParsedAckTopic | None:
    """Split an ack topic {tenant}/{device}/ack/{actuator}. Returns None on
    anything else — never raises.
    """
    parts = topic.split("/")
    if len(parts) != 4 or not all(parts) or parts[2] != "ack":
        return None
    tenant_slug, device_slug, _, actuator = parts
    return ParsedAckTopic(tenant_slug=tenant_slug, device_slug=device_slug, actuator=actuator)


@dataclass
class _CacheEntry:
    tenant_id: uuid.UUID
    device_id: uuid.UUID
    status: str
    cached_at: float


_directory_cache: dict[tuple[str, str], _CacheEntry] = {}


async def resolve_device_for_topic(
    session_factory: async_sessionmaker[AsyncSession],
    tenant_slug: str,
    device_slug: str,
) -> DeviceDirectoryRecord | None:
    """Resolve MQTT topic segments (tenant slug, device slug) to real ids.

    Public — both the storage path (record_telemetry_direct) and the hot path
    (app.rules.service.evaluate_and_dispatch) resolve the device exactly once
    per message, here, before either does anything else. Returns None if the
    device doesn't exist; callers also check `.status` themselves.
    """
    key = (tenant_slug, device_slug)
    cached = _directory_cache.get(key)
    if cached is not None and time.monotonic() - cached.cached_at < _DIRECTORY_CACHE_TTL_SECONDS:
        return DeviceDirectoryRecord(
            tenant_id=cached.tenant_id, device_id=cached.device_id, status=cached.status
        )

    async with session_factory() as session, session.begin():
        record = await devices_service.lookup_device_by_slug(session, tenant_slug, device_slug)

    if record is None:
        _directory_cache.pop(key, None)
        return None

    _directory_cache[key] = _CacheEntry(
        tenant_id=record.tenant_id,
        device_id=record.device_id,
        status=record.status,
        cached_at=time.monotonic(),
    )
    return record


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
    # Live-updates side channel (Phase 4) — separate from the stream above,
    # which the batched writer drains for storage. This is a plain PUBLISH,
    # not a queue: it's fine if nobody's listening, and it never blocks or
    # slows down the storage path it sits next to.
    await realtime_service.publish_event(
        tenant_id,
        {
            "type": "telemetry",
            "device_id": str(device_id),
            "metric": metric,
            "value": payload.value,
            "time": payload.timestamp or int(time.time()),
        },
    )
