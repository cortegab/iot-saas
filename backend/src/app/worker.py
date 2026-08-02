"""Ingestion worker — skeleton of the hot-path / storage-path process.

Phase 0/1 scope: prove the wiring end to end. Subscribe to every MQTT topic,
and for each telemetry message push a record onto a Redis stream and log it.
This is deliberately thin — payload validation, the in-memory rule evaluator,
the batched TimescaleDB writer, and the command path are added in Phases 2–3.

Design note (see CLAUDE.md §2): the API server never subscribes to MQTT and the
worker never serves HTTP. They are two processes from one codebase.
"""

import asyncio
import json
import logging
from typing import Any

import aiomqtt
import redis.asyncio as redis

from app.config import settings
from app.logging_config import configure_logging

configure_logging()
log = logging.getLogger("worker")

TELEMETRY_STREAM = "telemetry"
RECONNECT_SECONDS = 3

# Telemetry topics are {tenant}/{device}/{metric} — three levels. Command, state,
# and ack topics are four levels and belong to the command service, not ingestion,
# so this pattern deliberately excludes them. (It also avoids EMQX's default ACL,
# which denies subscribing to the bare '#' wildcard from non-localhost clients.)
TELEMETRY_TOPIC = "+/+/+"


async def handle_message(r: redis.Redis, topic: str, payload: bytes) -> None:
    """Parse one telemetry message and push it onto the Redis stream.

    A single malformed message is logged and dropped — it must never stop the
    stream (CLAUDE.md §7 / constraint 11).
    """
    try:
        data: dict[str, Any] = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("dropping malformed payload on %s: %r", topic, payload[:120])
        return

    value = data.get("value")
    if value is None:
        log.warning("dropping payload without 'value' on %s: %r", topic, data)
        return

    await r.xadd(
        TELEMETRY_STREAM,
        {"topic": topic, "value": str(value), "ts": str(data.get("timestamp", ""))},
    )
    log.info("telemetry %s -> value=%s", topic, value)


async def run() -> None:
    r: redis.Redis = redis.from_url(settings.redis_url, decode_responses=True)
    log.info(
        "worker starting; mqtt=%s:%s redis=%s",
        settings.mqtt_host,
        settings.mqtt_port,
        settings.redis_url,
    )

    while True:
        try:
            async with aiomqtt.Client(settings.mqtt_host, port=settings.mqtt_port) as client:
                log.info("connected to MQTT broker; subscribing to '%s'", TELEMETRY_TOPIC)
                await client.subscribe(TELEMETRY_TOPIC)
                async for message in client.messages:
                    await handle_message(r, str(message.topic), bytes(message.payload))
        except aiomqtt.MqttError as exc:
            log.warning("MQTT connection error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("worker stopped")
