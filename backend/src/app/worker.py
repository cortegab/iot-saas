"""Ingestion worker — the hot path and the storage path (CLAUDE.md §2). Four
concurrent loops in one process; there is no third process (the API server
never subscribes to MQTT, the worker never serves HTTP):

1. mqtt_ingest_loop — subscribes to telemetry AND ack topics, validates
   payloads, resolves each topic to a real device via
   app.ingestion.service's cache, runs rule evaluation/dispatch (the hot
   path — CLAUDE.md §9 constraint 1: before any queue hop), then XADDs a
   normalized telemetry entry onto the `telemetry` Redis stream.
2. stream_writer_loop — drains that stream through a consumer group (durable
   across worker restarts — the alternative, plain XREAD, would silently lose
   any buffered-but-unwritten telemetry on a crash, PLAN.md's called-out
   failure mode for this phase) and batch-inserts into the TimescaleDB
   hypertable in one multi-row INSERT per flush, regardless of how many
   tenants are in the batch. `telemetry` intentionally has no RLS — see the
   create_telemetry_hypertable migration for why — so unlike every other
   write path in this codebase, there's no per-tenant transaction to open here.
3. rule_cache_loop — loads active rules into memory at startup, then reloads
   on every app.rules.service.RULES_INVALIDATE_CHANNEL pub/sub message, so a
   rule CRUD change reaches the hot path within milliseconds.
4. manual_command_loop — fulfils dashboard-triggered actuator commands (Phase
   4). The API process has no MQTT client of its own, so a manual toggle is a
   request on app.commands.service.MANUAL_COMMAND_CHANNEL; this loop holds its
   own dedicated aiomqtt connection (separate from mqtt_ingest_loop's) and
   calls commands_service.dispatch_command with rule_id=None. Kept off
   mqtt_ingest_loop's connection deliberately: manual clicks are rare,
   user-triggered, and outside the <2s hot-path budget, so there's no
   throughput case for sharing that connection, and a slow/dead manual
   publish must never risk blocking telemetry ingestion.
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import cast

import aiomqtt
import redis.asyncio as redis
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands import service as commands_service
from app.commands.schemas import AckPayload
from app.config import settings
from app.db import session_factory
from app.devices import service as devices_service
from app.devices.models import DeviceStatus
from app.ingestion import service as ingestion_service
from app.ingestion.schemas import TelemetryPayload
from app.logging_config import configure_logging
from app.redis import redis_client
from app.rules import service as rules_service

configure_logging()
log = logging.getLogger("worker")

RECONNECT_SECONDS = 3
CONSUMER_GROUP = "telemetry-writer"
CONSUMER_NAME = "worker"

_INSERT_SQL = text(
    "INSERT INTO telemetry (time, tenant_id, device_id, metric, value) "
    "VALUES (:time, :tenant_id, :device_id, :metric, :value)"
)

_TelemetryRow = tuple[datetime, uuid.UUID, uuid.UUID, str, float]


async def handle_message(
    factory: async_sessionmaker[AsyncSession],
    r: redis.Redis,
    client: aiomqtt.Client,
    topic: str,
    payload: bytes,
) -> None:
    """Route one MQTT message to the ack path or the telemetry path. A single
    malformed message (bad topic, bad JSON, unknown/inactive device) is
    logged and dropped — it must never stop the stream (CLAUDE.md
    constraint 11).
    """
    ack_topic = ingestion_service.parse_ack_topic(topic)
    if ack_topic is not None:
        await _handle_ack(factory, ack_topic, payload)
        return

    parsed = ingestion_service.parse_topic(topic)
    if parsed is None:
        log.warning("dropping message on unparseable topic %r", topic)
        return

    try:
        data = TelemetryPayload.model_validate_json(payload)
    except ValidationError:
        log.warning("dropping malformed payload on %s: %r", topic, payload[:120])
        return

    resolved = await ingestion_service.resolve_device_for_topic(
        factory, parsed.tenant_slug, parsed.device_slug
    )
    if resolved is None or resolved.status != DeviceStatus.ACTIVE.value:
        log.warning("dropping telemetry for unknown/inactive device on %s", topic)
        return

    timestamp = (
        datetime.fromtimestamp(data.timestamp, tz=UTC) if data.timestamp else datetime.now(UTC)
    )

    # Hot path — in-memory, before the storage-path queue hop below
    # (CLAUDE.md §9 constraint 1).
    await rules_service.evaluate_and_dispatch(
        client,
        factory,
        resolved.tenant_id,
        resolved.device_id,
        parsed.tenant_slug,
        parsed.device_slug,
        parsed.metric,
        data.value,
        timestamp,
    )

    # Storage path (Phase 2, unchanged in behavior).
    await ingestion_service.record_telemetry_direct(
        r, resolved.tenant_id, resolved.device_id, parsed.metric, data
    )
    log.info("telemetry %s -> value=%s", topic, data.value)


async def _handle_ack(
    factory: async_sessionmaker[AsyncSession],
    ack_topic: ingestion_service.ParsedAckTopic,
    payload: bytes,
) -> None:
    try:
        ack = AckPayload.model_validate_json(payload)
    except ValidationError:
        log.warning(
            "dropping malformed ack payload on %s/%s/ack/%s",
            ack_topic.tenant_slug,
            ack_topic.device_slug,
            ack_topic.actuator,
        )
        return

    resolved = await ingestion_service.resolve_device_for_topic(
        factory, ack_topic.tenant_slug, ack_topic.device_slug
    )
    if resolved is None:
        log.warning(
            "dropping ack for unknown device %s/%s", ack_topic.tenant_slug, ack_topic.device_slug
        )
        return

    await commands_service.record_ack(factory, resolved.tenant_id, resolved.device_id, ack.command_id)
    log.info("command %s acked by %s/%s", ack.command_id, ack_topic.tenant_slug, ack_topic.device_slug)


async def mqtt_ingest_loop(factory: async_sessionmaker[AsyncSession], r: redis.Redis) -> None:
    log.info(
        "worker starting; mqtt=%s:%s redis=%s",
        settings.mqtt_host,
        settings.mqtt_port,
        settings.redis_url,
    )
    while True:
        try:
            async with aiomqtt.Client(
                settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_worker_username,
                password=settings.mqtt_worker_password.get_secret_value(),
            ) as client:
                log.info(
                    "connected to MQTT broker; subscribing to '%s' and '%s'",
                    ingestion_service.TELEMETRY_TOPIC_FILTER,
                    ingestion_service.ACK_TOPIC_FILTER,
                )
                await client.subscribe(ingestion_service.TELEMETRY_TOPIC_FILTER)
                await client.subscribe(ingestion_service.ACK_TOPIC_FILTER)
                async for message in client.messages:
                    await handle_message(
                        factory, r, client, str(message.topic), bytes(message.payload)
                    )
        except aiomqtt.MqttError as exc:
            log.warning("MQTT connection error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)


async def rule_cache_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Load active rules at startup, then reload on every invalidation
    message — a rule CRUD change reaches the hot path within milliseconds,
    not up to a stale TTL window later.
    """
    await rules_service.load_rule_cache(factory)
    while True:
        try:
            async with redis_client.pubsub() as pubsub:
                await pubsub.subscribe(rules_service.RULES_INVALIDATE_CHANNEL)
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    await rules_service.load_rule_cache(factory)
        except redis.RedisError as exc:
            log.warning(
                "rule invalidation channel error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS
            )
            await asyncio.sleep(RECONNECT_SECONDS)


async def _handle_manual_command(
    client: aiomqtt.Client, factory: async_sessionmaker[AsyncSession], raw: str
) -> None:
    """A single manual-command request is untrusted-shaped input from the
    API process, not a device — but the same discipline applies: a malformed
    entry is logged and dropped, never raised, so one bad request can't kill
    this loop for every other tenant's manual commands (CLAUDE.md constraint
    11, extended to this request path).
    """
    try:
        data = json.loads(raw)
        tenant_id = uuid.UUID(data["tenant_id"])
        device_id = uuid.UUID(data["device_id"])
        tenant_slug = str(data["tenant_slug"])
        device_slug = str(data["device_slug"])
        actuator = str(data["actuator"])
        value = data["value"]
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("dropping malformed manual command request: %s", exc)
        return

    await commands_service.dispatch_command(
        client,
        factory,
        tenant_id,
        device_id,
        None,
        datetime.now(UTC),
        tenant_slug,
        device_slug,
        actuator=actuator,
        value=value,
    )


async def manual_command_loop(factory: async_sessionmaker[AsyncSession], r: redis.Redis) -> None:
    while True:
        try:
            async with (
                aiomqtt.Client(
                    settings.mqtt_host,
                    port=settings.mqtt_port,
                    username=settings.mqtt_worker_username,
                    password=settings.mqtt_worker_password.get_secret_value(),
                ) as client,
                redis_client.pubsub() as pubsub,
            ):
                await pubsub.subscribe(commands_service.MANUAL_COMMAND_CHANNEL)
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    await _handle_manual_command(client, factory, message["data"])
        except (aiomqtt.MqttError, redis.RedisError) as exc:
            log.warning(
                "manual command loop error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS
            )
            await asyncio.sleep(RECONNECT_SECONDS)


async def _ensure_consumer_group(r: redis.Redis) -> None:
    try:
        await r.xgroup_create(
            ingestion_service.TELEMETRY_STREAM, CONSUMER_GROUP, id="0", mkstream=True
        )
    except redis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def _row_from_stream_entry(fields: dict[str, str]) -> _TelemetryRow | None:
    try:
        ts = int(fields["timestamp"]) if fields.get("timestamp") else None
        time_value = datetime.fromtimestamp(ts, tz=UTC) if ts else datetime.now(UTC)
        return (
            time_value,
            uuid.UUID(fields["tenant_id"]),
            uuid.UUID(fields["device_id"]),
            fields["metric"],
            float(fields["value"]),
        )
    except (KeyError, ValueError):
        return None


async def stream_writer_loop(factory: async_sessionmaker[AsyncSession], r: redis.Redis) -> None:
    await _ensure_consumer_group(r)
    buffer: list[_TelemetryRow] = []
    ack_ids: list[str] = []
    batch_size = settings.telemetry_batch_size
    block_ms = settings.telemetry_flush_interval_ms

    async def flush() -> None:
        nonlocal buffer, ack_ids
        if buffer:
            async with factory() as session, session.begin():
                await session.execute(
                    _INSERT_SQL,
                    [
                        {
                            "time": t,
                            "tenant_id": tid,
                            "device_id": did,
                            "metric": metric,
                            "value": value,
                        }
                        for t, tid, did, metric, value in buffer
                    ],
                )
                # Connection-state tracking, batched with this flush rather than
                # per-message so it never sits on the hot path. `seen_at` is one
                # timestamp for the whole batch (not each row's own reading time)
                # since this only has to be accurate to "the writer flushed
                # recently", not per-reading precision.
                await devices_service.touch_last_seen(
                    session, list({did for _, _, did, _, _ in buffer}), datetime.now(UTC)
                )
            await r.xack(ingestion_service.TELEMETRY_STREAM, CONSUMER_GROUP, *ack_ids)
            log.info("flushed %d telemetry rows", len(buffer))
        buffer = []
        ack_ids = []

    while True:
        raw = await r.xreadgroup(
            CONSUMER_GROUP,
            CONSUMER_NAME,
            {ingestion_service.TELEMETRY_STREAM: ">"},
            count=batch_size - len(buffer),
            block=block_ms,
        )
        # redis-py's stub covers both decode_responses=True/False shapes as a
        # Union; this client is always constructed with decode_responses=True
        # (app/redis.py), so the response is always the str-keyed list form.
        entries = cast(list[tuple[str, list[tuple[str, dict[str, str]]]]], raw)
        for _stream, messages in entries:
            for msg_id, fields in messages:
                row = _row_from_stream_entry(fields)
                if row is not None:
                    buffer.append(row)
                ack_ids.append(msg_id)

        if len(buffer) >= batch_size or not entries:
            await flush()


async def run() -> None:
    await asyncio.gather(
        mqtt_ingest_loop(session_factory, redis_client),
        stream_writer_loop(session_factory, redis_client),
        rule_cache_loop(session_factory),
        manual_command_loop(session_factory, redis_client),
    )


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("worker stopped")
