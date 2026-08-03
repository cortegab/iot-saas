"""Ingestion worker — the storage path (CLAUDE.md §2). Two concurrent loops in
one process; there is no third process (the API server never subscribes to
MQTT, the worker never serves HTTP):

1. mqtt_ingest_loop — subscribes to telemetry topics, validates payloads,
   resolves each topic to a real device via app.ingestion.service's cache, and
   XADDs a normalized entry onto the `telemetry` Redis stream.
2. stream_writer_loop — drains that stream through a consumer group (durable
   across worker restarts — the alternative, plain XREAD, would silently lose
   any buffered-but-unwritten telemetry on a crash, PLAN.md's called-out
   failure mode for this phase) and batch-inserts into the TimescaleDB
   hypertable in one multi-row INSERT per flush, regardless of how many
   tenants are in the batch. `telemetry` intentionally has no RLS — see the
   create_telemetry_hypertable migration for why — so unlike every other
   write path in this codebase, there's no per-tenant transaction to open here.

Rule evaluation, the in-memory hot path, and the command service are Phase 3 —
this worker only ever writes to storage.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import cast

import aiomqtt
import redis.asyncio as redis
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.db import session_factory
from app.ingestion import service as ingestion_service
from app.ingestion.schemas import TelemetryPayload
from app.logging_config import configure_logging
from app.redis import redis_client

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
    factory: async_sessionmaker[AsyncSession], r: redis.Redis, topic: str, payload: bytes
) -> None:
    """Parse and record one telemetry message. A single malformed message (bad
    topic, bad JSON, unknown/inactive device) is logged and dropped — it must
    never stop the stream (CLAUDE.md constraint 11).
    """
    parsed = ingestion_service.parse_topic(topic)
    if parsed is None:
        log.warning("dropping message on unparseable topic %r", topic)
        return

    try:
        data = TelemetryPayload.model_validate_json(payload)
    except ValidationError:
        log.warning("dropping malformed payload on %s: %r", topic, payload[:120])
        return

    recorded = await ingestion_service.record_telemetry(factory, r, parsed, data)
    if not recorded:
        log.warning("dropping telemetry for unknown/inactive device on %s", topic)
        return
    log.info("telemetry %s -> value=%s", topic, data.value)


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
                    "connected to MQTT broker; subscribing to '%s'",
                    ingestion_service.TELEMETRY_TOPIC_FILTER,
                )
                await client.subscribe(ingestion_service.TELEMETRY_TOPIC_FILTER)
                async for message in client.messages:
                    await handle_message(factory, r, str(message.topic), bytes(message.payload))
        except aiomqtt.MqttError as exc:
            log.warning("MQTT connection error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS)
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
    )


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("worker stopped")
