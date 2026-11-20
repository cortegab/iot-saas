"""Ingestion worker — the hot path and the storage path (CLAUDE.md §2). Nine
concurrent loops in one process, each restarted on its own by `supervise` if
it fails; there is no third process (the API server
never subscribes to MQTT, the worker never serves HTTP):

1. mqtt_ingest_loop — subscribes to telemetry AND ack topics, validates
   payloads, resolves each topic to a real device via
   app.ingestion.service's cache, runs rule evaluation/dispatch (the hot
   path — CLAUDE.md §9 constraint 1: before any queue hop), then XADDs a
   normalized telemetry entry onto the `telemetry` Redis stream. The reserved
   {tenant}/{device}/status topic (device health, CLAUDE.md §4) rides this
   same subscription and is routed to _handle_status instead — see
   RESERVED_METRIC_STATUS.
2. stream_writer_loop — drains that stream through a consumer group (durable
   across worker restarts — the alternative, plain XREAD, would silently lose
   any buffered-but-unwritten telemetry on a crash, docs/history/PLAN.md's called-out
   failure mode for this phase) and batch-inserts into the TimescaleDB
   hypertable in one multi-row INSERT per flush, regardless of how many
   tenants are in the batch. `telemetry` intentionally has no RLS — see the
   create_telemetry_hypertable migration for why — so unlike every other
   write path in this codebase, there's no per-tenant transaction to open
   here. The same flush also batches the per-metric health (Tier B) upsert
   next to the existing touch_last_seen call.
3. rule_cache_loop — loads active rules into memory at startup, then reloads
   on every app.rules.service.RULES_INVALIDATE_CHANNEL pub/sub message, so a
   rule CRUD change reaches the hot path within milliseconds.
4. manual_command_loop — fulfils dashboard-triggered actuator commands,
   retained-config-publish requests (Phase 2), AND out-of-band rule runs
   (Phase 4: manual "Run now" + schedule ticks, on
   app.rules.service.RULES_MANUAL_CHANNEL). The API process has no MQTT client
   of its own, so each is a Redis request; this loop holds its own dedicated
   aiomqtt connection (separate from mqtt_ingest_loop's) and branches on the
   channel. Kept off mqtt_ingest_loop's connection deliberately: all are rare,
   low-frequency, and outside the <2s hot-path budget, so there's no
   throughput case for sharing that connection, and a slow/dead publish here
   must never risk blocking telemetry ingestion.
5. health_monitor_loop — NOT a liveness poller (device liveness is fully
   event-driven: a device's own retained status message + MQTT Last-Will, see
   _handle_status). This is a profile-cache refresh: it recomputes every
   active device/metric's expected max-age from the catalog's publish profile
   and hands it to app.rules.service.reload_staleness_thresholds, a lookaside
   cache the hot path only ever reads. Reloads at startup and on every
   app.catalog.service.CATALOG_INVALIDATE_CHANNEL message.
6. schedule_loop — timer-driven (aligned to minute boundaries). Each tick,
   publishes a RULES_MANUAL_CHANNEL request for every scheduled rule whose
   cron matches — manual_command_loop does the actual evaluate + dispatch, so
   there's one shared out-of-band run path. Missed ticks on a restart are
   dropped, not caught up.
7. rules_maintenance_loop — timer-driven (rules_maintenance_interval_seconds).
   Checkpoints _rule_states to Redis (rules:state) so armed/cooldown/hold
   progress survives a normal restart — restored once by rule_cache_loop at
   startup; a hard crash between ticks loses at most one interval of progress.
   Same tick re-checks every rule's "can it currently evaluate" state and
   emits a rule_health realtime event (+ one platform notification) on a
   transition to un-evaluatable.
8. pending_timer_loop — timer-driven (rules_pending_timer_interval_seconds).
   Re-runs rules whose for_duration hold or on-clear delay is waiting on the
   clock rather than a new reading, via the same out-of-band path.
"""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import cast

import aiomqtt
import redis.asyncio as redis
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import service as catalog_service
from app.commands import service as commands_service
from app.commands.schemas import AckPayload
from app.config import settings
from app.db import session_factory
from app.devices import service as devices_service
from app.devices.models import DeviceStatus
from app.firmware import service as firmware_service
from app.health import service as health_service
from app.ingestion import service as ingestion_service
from app.ingestion.schemas import StatusPayload, TelemetryPayload
from app.logging_config import configure_logging
from app.notifications import service as notifications_service
from app.push import sender as push_sender
from app.readiness import service as readiness_service
from app.realtime import service as realtime_service
from app.redis import redis_client
from app.rules import service as rules_service

configure_logging()
log = logging.getLogger("worker")

RECONNECT_SECONDS = 3

# For the heartbeat (app.readiness): whether the ingest loop holds a broker
# connection, and when it last handled a message (monotonic seconds).
_mqtt_connected = False
_last_message_at: float | None = None
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
    *,
    retain: bool = False,
) -> None:
    """Route one MQTT message to the ack path or the telemetry path. A single
    malformed message (bad topic, bad JSON, unknown/inactive device) is
    logged and dropped — it must never stop the stream (CLAUDE.md
    constraint 11).

    `retain` is the broker's retained flag. Only `status` is retained by
    contract (CLAUDE.md §4); retained telemetry would be re-delivered on every
    reconnect and replayed into the rules, so it's dropped.
    """
    ack_topic = ingestion_service.parse_ack_topic(topic)
    if ack_topic is not None:
        await _handle_ack(factory, ack_topic, payload)
        return

    parsed = ingestion_service.parse_topic(topic)
    if parsed is None:
        log.warning("dropping message on unparseable topic %r", topic)
        return

    if parsed.metric == ingestion_service.RESERVED_METRIC_STATUS:
        await _handle_status(factory, client, parsed, payload)
        return
    if parsed.metric in ingestion_service.PLATFORM_TO_DEVICE_SEGMENTS:
        return  # our own publish to the device, echoed back
    if retain:
        log.warning("dropping retained telemetry on %s (only status is retained)", topic)
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

    timestamp = ingestion_service.reading_time(data)

    # Hot path — in-memory, before the storage-path queue hop below
    # (CLAUDE.md §9 constraint 1). Rules run on the server's clock: hold
    # times, cooldowns and staleness must not depend on a device's clock
    # (a skewed one would satisfy for_duration early, or block a rule with a
    # future last_fired_at). The stored reading keeps the device's time.
    await rules_service.evaluate_and_dispatch(
        client,
        factory,
        resolved.tenant_id,
        resolved.device_id,
        parsed.tenant_slug,
        parsed.device_slug,
        parsed.metric,
        data.value,
        datetime.now(UTC),
    )

    # Storage path — carries the same timestamp the hot path just used.
    await ingestion_service.record_telemetry_direct(
        r, resolved.tenant_id, resolved.device_id, parsed.metric, data, timestamp
    )
    log.info("telemetry %s -> value=%s", topic, data.value)


async def _handle_status(
    factory: async_sessionmaker[AsyncSession],
    client: aiomqtt.Client,
    parsed: ingestion_service.ParsedTopic,
    payload: bytes,
) -> None:
    """Tier A device-health write, from a retained {tenant}/{device}/status
    message (CLAUDE.md §4) — the device's own periodic self-report, or its
    Last-Will firing `online: false` on ungraceful disconnect. Off the hot
    path deliberately: status messages are low-frequency (connect + periodic
    + one LWT), nowhere near telemetry volume, so this doesn't need
    stream_writer_loop's batching discipline (same reasoning
    commands_service.dispatch_command's synchronous command-row insert uses).

    Also the device_status rule trigger's entry point: unlike the
    unconditional "device_health" event below (published on every status
    message), rules only fire on a genuine connectivity flip — see
    rules_service.note_device_status.
    """
    try:
        data = StatusPayload.model_validate_json(payload)
    except ValidationError:
        log.warning(
            "dropping malformed status payload on %s/%s/status: %r",
            parsed.tenant_slug,
            parsed.device_slug,
            payload[:120],
        )
        return

    resolved = await ingestion_service.resolve_device_for_topic(
        factory, parsed.tenant_slug, parsed.device_slug
    )
    if resolved is None:
        log.warning(
            "dropping status for unknown device %s/%s", parsed.tenant_slug, parsed.device_slug
        )
        return

    received_at = datetime.now(UTC)
    # Only firmware that reports diagnostics (0.14.0+) sends boot_count.
    diagnostics = (
        devices_service.StatusDiagnostics(
            reset_reason=data.reset_reason,
            boot_count=data.boot_count,
            heap_free=data.heap_free,
            heap_min=data.heap_min,
            wifi_reconnects=data.wifi_reconnects,
            faults=data.faults,
            ota_state=data.ota,
        )
        if data.boot_count is not None
        else None
    )
    change = await devices_service.record_status_snapshot(
        factory,
        resolved.tenant_id,
        resolved.device_id,
        online=data.online,
        rssi=data.rssi,
        battery_pct=data.battery_pct,
        uptime_s=data.uptime_s,
        fw_version=data.fw_version,
        received_at=received_at,
        diagnostics=diagnostics,
    )
    await realtime_service.publish_event(
        resolved.tenant_id,
        {
            "type": "device_health",
            "device_id": str(resolved.device_id),
            "online": data.online,
            "rssi": data.rssi,
            "battery_pct": data.battery_pct,
            "uptime_s": data.uptime_s,
            "fw_version": data.fw_version,
            "reset_reason": data.reset_reason,
            "boot_count": data.boot_count,
            "heap_free": data.heap_free,
            "heap_min": data.heap_min,
            "wifi_reconnects": data.wifi_reconnects,
            "faults": data.faults,
            "ota": data.ota,
        },
    )
    if resolved.status != DeviceStatus.DISABLED:
        await _alert_device_health(
            factory, resolved.tenant_id, resolved.device_id, parsed.device_slug, data, change
        )
    log.info("status %s/%s -> online=%s", parsed.tenant_slug, parsed.device_slug, data.online)

    if rules_service.note_device_status(resolved.device_id, data.online):
        await rules_service.run_device_status_rules(
            client, factory, resolved.tenant_id, resolved.device_id, data.online
        )
        # A genuine flip to offline (never the first observation after a
        # restart, so retained LWTs don't re-alert) is a critical feed row.
        if not data.online and resolved.status != DeviceStatus.DISABLED:
            try:
                await notifications_service.create_notification(
                    factory,
                    resolved.tenant_id,
                    resolved.device_id,
                    None,
                    f"{parsed.device_slug} went offline",
                    severity="critical",
                    kind="device_offline",
                    detail="Its last will arrived: the connection dropped without a goodbye.",
                )
            except Exception:
                log.exception("offline notification failed for %s", resolved.device_id)


# Restarts worth an alert, as the firmware reports them (firmware/src/diag.h);
# a power-on, the reset pin or the firmware's own restart are not news.
ABNORMAL_RESTARTS = {
    "crash": "a crash",
    "task_wdt": "a frozen loop (watchdog)",
    "interrupt_wdt": "a watchdog reset",
    "other_wdt": "a watchdog reset",
    "brownout": "a power dip (brown-out)",
}


async def _alert_device_health(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    device_slug: str,
    data: StatusPayload,
    change: devices_service.StatusChange,
) -> None:
    """Device-health alerts from the status diagnostics: a new boot after a
    crash, watchdog or brown-out, and each sensor that newly stopped
    answering. A failure here never drops the status message."""
    alerts: list[tuple[str, str]] = []
    cause = ABNORMAL_RESTARTS.get(data.reset_reason or "")
    if change.restarted and cause:
        alerts.append(
            (
                f"{device_slug} restarted after {cause}",
                (
                    f"Boot {data.boot_count}. It came back on its own; if this repeats, check its "
                    "power supply and wiring, and its serial log."
                ),
            )
        )
    if change.ota_problem is not None:
        version = change.ota_problem.get("version", "?")
        failed = change.ota_problem.get("state") == "failed"
        alerts.append(
            (
                f"{device_slug}: update to {version} "
                + ("failed" if failed else "was rolled back"),
                change.ota_problem.get("error")
                or "It kept the version it had; see its Settings → Firmware.",
            )
        )
    for fault in change.new_faults:
        alerts.append(
            (
                f"{device_slug}: {fault}",
                "The device reads it as unknown and keeps retrying; check the sensor's wiring and power.",
            )
        )
    for message, detail in alerts:
        try:
            await notifications_service.create_notification(
                factory,
                tenant_id,
                device_id,
                None,
                message,
                severity="warning",
                kind="device_health",
                detail=detail,
            )
        except Exception:
            log.exception("device-health notification failed for %s", device_id)


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

    await commands_service.record_ack(
        factory, resolved.tenant_id, resolved.device_id, ack.command_id
    )
    log.info(
        "command %s acked by %s/%s", ack.command_id, ack_topic.tenant_slug, ack_topic.device_slug
    )


async def mqtt_ingest_loop(factory: async_sessionmaker[AsyncSession], r: redis.Redis) -> None:
    log.info(
        "worker starting; mqtt=%s:%s redis=%s",
        settings.mqtt_host,
        settings.mqtt_port,
        settings.redis_url,
    )
    global _mqtt_connected, _last_message_at
    while True:
        try:
            async with aiomqtt.Client(
                settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_worker_username,
                password=settings.mqtt_worker_password.get_secret_value(),
            ) as client:
                _mqtt_connected = True
                log.info(
                    "connected to MQTT broker; subscribing to '%s' and '%s'",
                    ingestion_service.TELEMETRY_TOPIC_FILTER,
                    ingestion_service.ACK_TOPIC_FILTER,
                )
                await client.subscribe(ingestion_service.TELEMETRY_TOPIC_FILTER)
                await client.subscribe(ingestion_service.ACK_TOPIC_FILTER)
                async for message in client.messages:
                    _last_message_at = time.monotonic()
                    topic = str(message.topic)
                    try:
                        await handle_message(
                            factory,
                            r,
                            client,
                            topic,
                            bytes(message.payload),
                            retain=bool(message.retain),
                        )
                    except aiomqtt.MqttError:
                        raise  # the connection itself: reconnect below
                    except Exception:
                        # One message must never stop ingestion for every
                        # tenant (CLAUDE.md constraint 11): a Redis or DB blip
                        # while handling it drops that message, not the loop.
                        log.exception("dropping message on %s after an error", topic)
        except aiomqtt.MqttError as exc:
            _mqtt_connected = False
            log.warning("MQTT connection error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)


_rule_states_restored = False
# The worker re-reads every enabled rule this often even without an
# invalidation message.
RULE_CACHE_REFRESH_SECONDS = 60.0


async def rule_cache_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Load active rules at startup, then reload on every invalidation
    message — a rule CRUD change reaches the hot path within milliseconds,
    not up to a stale TTL window later.
    """
    global _rule_states_restored
    await rules_service.load_rule_cache(factory)
    # Restore the _rule_states checkpoint now that _rules_by_id is populated
    # (so states for rules deleted while the worker was down are dropped).
    # Once per process: when the supervisor restarts this loop, the live
    # in-memory state is newer than the checkpoint.
    if not _rule_states_restored:
        await rules_service.restore_rule_states()
        _rule_states_restored = True
    while True:
        try:
            async with redis_client.pubsub() as pubsub:
                await pubsub.subscribe(rules_service.RULES_INVALIDATE_CHANNEL)
                # Edits published while this channel was down were missed:
                # reload once subscribed, so nothing falls in the gap.
                await rules_service.load_rule_cache(factory)
                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=RULE_CACHE_REFRESH_SECONDS
                    )
                    # A message means a rule changed; a timeout is the
                    # periodic re-read, which also covers an invalidation the
                    # API failed to publish after its commit.
                    await rules_service.load_rule_cache(factory)
                    if message is None:
                        log.debug("periodic rule cache refresh")
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


async def _handle_config_publish(
    client: aiomqtt.Client, factory: async_sessionmaker[AsyncSession], raw: str
) -> None:
    """Publish the retained {tenant}/{device}/config message (CLAUDE.md §4)
    to every active device on a catalog entry — requested by
    app.catalog.service after a metrics/publish-profile edit or a new
    device's creation, never a side effect of an inbound message. Malformed
    or empty requests are dropped, never raised (CLAUDE.md constraint 11
    extended to this request path, same as _handle_manual_command).
    """
    try:
        data = json.loads(raw)
        entry_id = uuid.UUID(data["catalog_entry_id"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("dropping malformed config-publish request: %s", exc)
        return

    devices = await catalog_service.list_devices_for_config_publish(factory, entry_id)
    if not devices:
        return

    metrics_payload = [
        {
            "key": m["key"],
            "publish": m.get("publish", "periodic"),
            "interval_seconds": m.get("publish_interval_seconds"),
            "deadband": m.get("publish_deadband"),
            # The firmware sends readings with these decimals and compares
            # "on change" on the rounded value (FW 0.13.0+; older ignores it,
            # and null/absent means 3, what every firmware sent before).
            "decimals": m.get("decimals"),
        }
        for m in devices[0].metrics
        if m.get("key")
    ]
    payload = json.dumps(
        {"metrics": metrics_payload, "issued_at": int(datetime.now(UTC).timestamp())}
    )
    for row in devices:
        await client.publish(
            f"{row.tenant_slug}/{row.device_slug}/config", payload, qos=1, retain=True
        )
    log.info("published config to %d device(s) for catalog entry %s", len(devices), entry_id)


async def _handle_rule_trigger(
    client: aiomqtt.Client, factory: async_sessionmaker[AsyncSession], raw: str
) -> None:
    """One out-of-band rule run — a manual "Run now" (`POST /rules/{id}/run`),
    a schedule_loop tick, or a pending_timer_loop re-evaluation — or a latch
    reset (`POST /rules/{id}/reset`, trigger_source "reset"). Malformed
    requests are dropped, never raised (CLAUDE.md constraint 11, same as
    _handle_manual_command)."""
    try:
        data = json.loads(raw)
        tenant_id = uuid.UUID(data["tenant_id"])
        rule_id = uuid.UUID(data["rule_id"])
        trigger_source = str(data["trigger_source"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("dropping malformed rule-trigger request: %s", exc)
        return

    if trigger_source == "reset":
        await rules_service.reset_rule_latch(tenant_id, rule_id)
        return
    await rules_service.run_rule_out_of_band(client, factory, tenant_id, rule_id, trigger_source)


async def _handle_ota_request(client: aiomqtt.Client, raw: str | bytes) -> None:
    """An admin asked a device to update (app.firmware): publish the request
    on {tenant}/{device}/ota. QoS 1, not retained: a device that's offline now
    must not install it on some later reconnect without anyone asking."""
    try:
        data = json.loads(raw)
        topic = f"{data['tenant_slug']}/{data['device_slug']}/ota"
        payload = json.dumps(data["payload"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("dropping malformed ota request: %s", exc)
        return
    await client.publish(topic, payload, qos=1)
    log.info("ota request -> %s (version %s)", topic, data["payload"].get("version"))


async def _handle_http_reading(
    client: aiomqtt.Client, factory: async_sessionmaker[AsyncSession], raw: str
) -> None:
    """A reading the API accepted over HTTP ingest: run the rules on it, as
    for an MQTT reading. The API stores it; this only evaluates."""
    try:
        data = json.loads(raw)
        tenant_id = uuid.UUID(data["tenant_id"])
        device_id = uuid.UUID(data["device_id"])
        tenant_slug = str(data["tenant_slug"])
        device_slug = str(data["device_slug"])
        metric = str(data["metric"])
        value = float(data["value"])
    except (KeyError, TypeError, ValueError) as exc:
        log.warning("dropping malformed http reading: %s", exc)
        return
    # Server time, like an MQTT reading (see handle_message).
    await rules_service.evaluate_and_dispatch(
        client,
        factory,
        tenant_id,
        device_id,
        tenant_slug,
        device_slug,
        metric,
        value,
        datetime.now(UTC),
    )


async def _route_request(
    client: aiomqtt.Client, factory: async_sessionmaker[AsyncSession], channel: str, data: str
) -> None:
    if channel == catalog_service.CONFIG_PUBLISH_CHANNEL:
        await _handle_config_publish(client, factory, data)
    elif channel == rules_service.RULES_MANUAL_CHANNEL:
        await _handle_rule_trigger(client, factory, data)
    elif channel == firmware_service.OTA_CHANNEL:
        await _handle_ota_request(client, data)
    elif channel == ingestion_service.HTTP_READING_CHANNEL:
        await _handle_http_reading(client, factory, data)
    else:
        await _handle_manual_command(client, factory, data)


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
                await pubsub.subscribe(
                    commands_service.MANUAL_COMMAND_CHANNEL,
                    catalog_service.CONFIG_PUBLISH_CHANNEL,
                    rules_service.RULES_MANUAL_CHANNEL,
                    firmware_service.OTA_CHANNEL,
                    ingestion_service.HTTP_READING_CHANNEL,
                )
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    try:
                        await _route_request(client, factory, message["channel"], message["data"])
                    except (aiomqtt.MqttError, redis.RedisError):
                        raise  # the connection itself: reconnect below
                    except Exception:
                        log.exception("dropping %s request after an error", message["channel"])
        except (aiomqtt.MqttError, redis.RedisError) as exc:
            log.warning(
                "manual command loop error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS
            )
            await asyncio.sleep(RECONNECT_SECONDS)


def _seconds_to_next_minute() -> float:
    now = datetime.now(UTC)
    return 60.0 - now.second - now.microsecond / 1_000_000


async def _tick_schedules() -> None:
    """One scheduler pass: publish a run request for every scheduled rule
    whose cron matches this minute. manual_command_loop does the actual
    evaluation + dispatch (shared with manual "Run now")."""
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    for rule in rules_service.scheduled_rules_snapshot():
        if rules_service.schedule_due(rule, now):
            await redis_client.publish(
                rules_service.RULES_MANUAL_CHANNEL,
                json.dumps(
                    {
                        "tenant_id": str(rule.tenant_id),
                        "rule_id": str(rule.id),
                        "trigger_source": "schedule",
                    }
                ),
            )


async def schedule_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Timer-driven — fires scheduled rules on their cron. Reads the
    in-process `_scheduled_rules` cache (kept current by rule_cache_loop);
    holds no MQTT client and no DB session. Missed ticks on a restart are
    dropped, not caught up — documented, same posture as RuleState not
    surviving a restart."""
    while True:
        try:
            await _tick_schedules()
        except redis.RedisError as exc:
            log.warning("schedule loop error (%s); retrying in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)
            continue
        await asyncio.sleep(_seconds_to_next_minute())


async def rules_maintenance_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Periodic (rules_maintenance_interval_seconds): checkpoint _rule_states
    to Redis so armed/cooldown/for_duration progress survives a normal
    restart, and re-check every rule's "can it currently evaluate" state to
    emit a rule_health realtime event (+ one platform notification) on a
    transition. Holds no MQTT client. Each tick is defensively wrapped so a
    bad rule never kills the loop."""
    # Give rule_cache_loop's startup load_rule_cache a moment to populate
    # _rules_by_id and let a few telemetry messages warm _signal_value_cache.
    await asyncio.sleep(15)
    while True:
        try:
            await rules_service.emit_rule_health_transitions(factory)
        except Exception:
            log.exception("rule health transition tick failed")
        try:
            await rules_service.snapshot_rule_states()
        except Exception:
            log.exception("rule state snapshot tick failed")
        await asyncio.sleep(settings.rules_maintenance_interval_seconds)


async def pending_timer_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Timer-driven (rules_pending_timer_interval_seconds): finish for_duration
    holds and clear delays that no new reading will arrive to complete — an
    on_change switch publishes one "released" reading and then goes quiet.
    Pure in-memory scan; each due rule is re-run through the shared
    out-of-band path (RULES_MANUAL_CHANNEL -> manual_command_loop), exactly
    like schedule_loop, so there's still only one MQTT client for it."""
    while True:
        await asyncio.sleep(settings.rules_pending_timer_interval_seconds)
        try:
            for rule in rules_service.pending_timer_rules():
                await redis_client.publish(
                    rules_service.RULES_MANUAL_CHANNEL,
                    json.dumps(
                        {
                            "tenant_id": str(rule.tenant_id),
                            "rule_id": str(rule.id),
                            "trigger_source": "metric",
                        }
                    ),
                )
        except redis.RedisError as exc:
            log.warning("pending timer loop error (%s); retrying in %ss", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)


async def _ensure_consumer_group(r: redis.Redis) -> None:
    try:
        await r.xgroup_create(
            ingestion_service.TELEMETRY_STREAM, CONSUMER_GROUP, id="0", mkstream=True
        )
    except redis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def _should_flush(buffered: int, oldest_age_s: float, batch_size: int, interval_s: float) -> bool:
    """Flush on a full batch, or once the oldest buffered row has waited a
    whole flush interval. (Waiting for an *idle* read instead meant a device
    publishing steadily — never a quiet second — was only stored every
    `batch_size` readings: minutes at a few readings per second.)"""
    return buffered >= batch_size or (buffered > 0 and oldest_age_s >= interval_s)


def _row_from_stream_entry(fields: dict[str, str] | None) -> _TelemetryRow | None:
    if not fields:
        return None  # trimmed from the stream while it was still pending
    try:
        # Float epoch seconds (sub-second receive time). Entries queued by an
        # older worker may be int strings or empty — float() and the now()
        # fallback cover both.
        ts = float(fields["timestamp"]) if fields.get("timestamp") else None
        time_value = datetime.fromtimestamp(ts, tz=UTC) if ts else datetime.now(UTC)
        return (
            time_value,
            uuid.UUID(fields["tenant_id"]),
            uuid.UUID(fields["device_id"]),
            fields["metric"],
            float(fields["value"]),
        )
    except (KeyError, ValueError, OverflowError, OSError):
        return None


async def _insert_batch(session: AsyncSession, rows: list[_TelemetryRow]) -> None:
    await session.execute(
        _INSERT_SQL,
        [
            {"time": t, "tenant_id": tid, "device_id": did, "metric": metric, "value": value}
            for t, tid, did, metric, value in rows
        ],
    )


async def _insert_rows_one_by_one(
    session: AsyncSession, rows: list[_TelemetryRow]
) -> list[_TelemetryRow]:
    """Fallback after the batch INSERT failed on a constraint: each row in its
    own savepoint, so a row whose device was deleted while it sat in the
    stream (telemetry.device_id references devices) is dropped alone instead
    of taking the whole batch with it. Returns the rows that were stored."""
    stored: list[_TelemetryRow] = []
    for row in rows:
        try:
            async with session.begin_nested():
                await _insert_batch(session, [row])
            stored.append(row)
        except IntegrityError:
            log.warning(
                "dropping telemetry row for tenant=%s device=%s metric=%s: %s",
                row[1],
                row[2],
                row[3],
                "its device or tenant no longer exists",
            )
    return stored


async def write_telemetry_batch(
    factory: async_sessionmaker[AsyncSession], rows: list[_TelemetryRow]
) -> int:
    """Store one batch plus the per-device bookkeeping in one transaction.
    Returns how many rows were stored. Raises when the database itself fails
    (the caller keeps the rows and retries)."""
    async with factory() as session, session.begin():
        try:
            async with session.begin_nested():
                await _insert_batch(session, rows)
            stored = rows
        except IntegrityError:
            stored = await _insert_rows_one_by_one(session, rows)
        if not stored:
            return 0
        # Connection-state tracking, batched with this flush rather than
        # per-message so it never sits on the hot path. `seen_at` is one
        # timestamp for the whole batch (not each row's own reading time)
        # since this only has to be accurate to "the writer flushed
        # recently", not per-reading precision.
        await devices_service.touch_last_seen(
            session, list({did for _, _, did, _, _ in stored}), datetime.now(UTC)
        )
        # Per-(device, metric) freshness (Tier B), batched with this flush
        # for the same reason touch_last_seen is: the last value per key
        # within the batch wins, one shared seen_at for the whole batch.
        latest: dict[tuple[uuid.UUID, str], float] = {}
        for _, _, did, metric, value in stored:
            latest[(did, metric)] = value
        await health_service.record_batch(
            session,
            [(did, metric, value) for (did, metric), value in latest.items()],
            datetime.now(UTC),
        )
    return len(stored)


FLUSH_RETRY_MAX_SECONDS = 30.0


async def drain_pending(
    factory: async_sessionmaker[AsyncSession], r: redis.Redis, batch_size: int
) -> int:
    """Store the entries this consumer read but never acknowledged: the batch
    that was in memory when the worker stopped. Reading the group from id "0"
    returns this consumer's pending entries (">" only returns new ones), so
    without this they would stay pending forever and never reach the
    database. Returns how many rows were stored."""
    total = 0
    while True:
        raw = await r.xreadgroup(
            CONSUMER_GROUP,
            CONSUMER_NAME,
            {ingestion_service.TELEMETRY_STREAM: "0"},
            count=batch_size,
        )
        entries = cast(list[tuple[str, list[tuple[str, dict[str, str] | None]]]], raw)
        messages = [m for _stream, batch in entries for m in batch]
        if not messages:
            break
        rows = [row for _id, fields in messages if (row := _row_from_stream_entry(fields))]
        if rows:
            total += await write_telemetry_batch(factory, rows)
        await r.xack(
            ingestion_service.TELEMETRY_STREAM, CONSUMER_GROUP, *[msg_id for msg_id, _ in messages]
        )
    if total:
        log.info("stored %d telemetry rows left pending by the previous run", total)
    return total


async def stream_writer_loop(factory: async_sessionmaker[AsyncSession], r: redis.Redis) -> None:
    await _ensure_consumer_group(r)
    await drain_pending(factory, r, settings.telemetry_batch_size)
    buffer: list[_TelemetryRow] = []
    ack_ids: list[str] = []
    batch_size = settings.telemetry_batch_size
    block_ms = settings.telemetry_flush_interval_ms
    interval_s = block_ms / 1000
    # When the oldest row still in `buffer` arrived (monotonic seconds).
    first_buffered_at = 0.0
    # Seconds to wait before retrying a flush the database refused.
    retry_delay = 0.0

    async def flush() -> None:
        nonlocal buffer, ack_ids
        if buffer:
            stored = await write_telemetry_batch(factory, buffer)
            log.info("flushed %d telemetry rows", stored)
        if ack_ids:
            await r.xack(ingestion_service.TELEMETRY_STREAM, CONSUMER_GROUP, *ack_ids)
        buffer = []
        ack_ids = []

    loop = asyncio.get_running_loop()
    while True:
        if len(buffer) < batch_size:
            # With rows waiting, block only until the oldest one is due.
            wait_ms = block_ms
            if buffer:
                wait_ms = max(1, int((first_buffered_at + interval_s - loop.time()) * 1000))
            raw = await r.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {ingestion_service.TELEMETRY_STREAM: ">"},
                count=batch_size - len(buffer),
                block=wait_ms,
            )
            # redis-py's stub covers both decode_responses=True/False shapes as a
            # Union; this client is always constructed with decode_responses=True
            # (app/redis.py), so the response is always the str-keyed list form.
            entries = cast(list[tuple[str, list[tuple[str, dict[str, str]]]]], raw)
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    row = _row_from_stream_entry(fields)
                    if row is not None:
                        if not buffer:
                            first_buffered_at = loop.time()
                        buffer.append(row)
                    ack_ids.append(msg_id)

        if _should_flush(len(buffer), loop.time() - first_buffered_at, batch_size, interval_s) or (
            not buffer and ack_ids
        ):
            try:
                await flush()
                retry_delay = 0.0
            except redis.RedisError:
                raise
            except Exception:
                # The database is down or refusing: keep the rows (they are
                # still unacknowledged in the stream too) and try again,
                # backing off, instead of losing the batch.
                retry_delay = min(max(retry_delay * 2, 1.0), FLUSH_RETRY_MAX_SECONDS)
                log.exception(
                    "telemetry flush of %d rows failed; retrying in %.0fs", len(buffer), retry_delay
                )
                await asyncio.sleep(retry_delay)


async def health_monitor_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    """Profile-cache refresh, not a liveness poller — see the module
    docstring. Reload at startup, then on every catalog:invalidate message,
    so a publish-profile edit reaches the hot path's staleness bound within
    seconds, not just at worker restart. Mirrors rule_cache_loop's shape.
    """

    async def _reload() -> None:
        thresholds = await health_service.compute_staleness_thresholds(factory)
        rules_service.reload_staleness_thresholds(thresholds)

    await _reload()
    while True:
        try:
            async with redis_client.pubsub() as pubsub:
                await pubsub.subscribe(catalog_service.CATALOG_INVALIDATE_CHANNEL)
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    await _reload()
        except redis.RedisError as exc:
            log.warning(
                "catalog invalidation channel error (%s); reconnecting in %ss",
                exc,
                RECONNECT_SECONDS,
            )
            await asyncio.sleep(RECONNECT_SECONDS)


def heartbeat_payload(now: float, monotonic_now: float) -> str:
    idle = None if _last_message_at is None else round(monotonic_now - _last_message_at, 1)
    return json.dumps(
        {"ts": now, "mqtt_connected": _mqtt_connected, "seconds_since_last_message": idle}
    )


async def heartbeat_loop() -> None:
    """Tell app.readiness the worker is alive (and connected to the broker).
    The key expires on its own, so a dead worker reads as "no heartbeat"."""
    while True:
        await redis_client.set(
            readiness_service.HEARTBEAT_KEY,
            heartbeat_payload(time.time(), time.monotonic()),
            ex=readiness_service.HEARTBEAT_MAX_AGE_SECONDS * 2,
        )
        await asyncio.sleep(readiness_service.HEARTBEAT_INTERVAL_SECONDS)


SUPERVISOR_MAX_BACKOFF_SECONDS = 30.0
# A loop that ran this long before failing starts its backoff over.
SUPERVISOR_HEALTHY_SECONDS = 60.0


async def supervise(name: str, start: Callable[[], Awaitable[None]]) -> None:
    """Run one worker loop forever. An unexpected exception restarts that loop
    alone, after a backoff, instead of ending asyncio.gather and with it the
    hot path for every tenant. Cancellation (shutdown) still propagates."""
    backoff = 1.0
    while True:
        started = time.monotonic()
        try:
            await start()
            log.warning("worker loop %s returned; restarting", name)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("worker loop %s failed; restarting in %.0fs", name, backoff)
        if time.monotonic() - started >= SUPERVISOR_HEALTHY_SECONDS:
            backoff = 1.0
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, SUPERVISOR_MAX_BACKOFF_SECONDS)


async def run() -> None:
    f, r = session_factory, redis_client
    loops: dict[str, Callable[[], Awaitable[None]]] = {
        "mqtt_ingest": lambda: mqtt_ingest_loop(f, r),
        "stream_writer": lambda: stream_writer_loop(f, r),
        "rule_cache": lambda: rule_cache_loop(f),
        "manual_command": lambda: manual_command_loop(f, r),
        "health_monitor": lambda: health_monitor_loop(f),
        "schedule": lambda: schedule_loop(f),
        "rules_maintenance": lambda: rules_maintenance_loop(f),
        "pending_timer": lambda: pending_timer_loop(f),
        "push": lambda: push_sender.push_loop(f),
        "heartbeat": heartbeat_loop,
    }
    try:
        await asyncio.gather(*(supervise(name, start) for name, start in loops.items()))
    finally:
        # Best-effort drain of in-flight webhook/email deliveries on shutdown.
        pending = [t for t in rules_service._BACKGROUND_TASKS if not t.done()]
        if pending:
            log.info("draining %d in-flight deferred actions", len(pending))
            try:
                await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=5)
            except TimeoutError:
                log.warning("deferred-action drain timed out; %d still pending", len(pending))
        # Final _rule_states checkpoint so a graceful restart loses nothing.
        try:
            await asyncio.wait_for(rules_service.snapshot_rule_states(), timeout=2)
        except TimeoutError:
            log.warning("final rule state checkpoint timed out")


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("worker stopped")
