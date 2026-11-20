"""Actuator command dispatch and acknowledgement — the platform->device half
of CLAUDE.md §4's device contract (`cmd`/`state` topics out, `ack` topics in).

Called from the hot path (app/worker.py, via app/rules/service.py) right
after a rule fires. The MQTT publish happens first, on the same already-
connected client the worker uses for ingestion, so there's no new connection/
handshake latency on the path being measured; the audit-log write happens
after, as a single synchronous INSERT (not batched like telemetry — commands
fire far less often, so there's no throughput case for batching, and a
synchronous insert can't lose an audit record the way an unflushed buffer
could).
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, NamedTuple

import aiomqtt
from sqlalchemy import ColumnElement, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands.models import Command
from app.config import settings
from app.db import set_tenant_context
from app.realtime import service as realtime_service
from app.redis import redis_client
from app.shared.topics import is_topic_segment
from app.tenants import service as tenants_service

log = logging.getLogger("commands")

# Dashboard-triggered manual commands (Phase 4): the API process holds no MQTT
# client of its own (CLAUDE.md §2 — "the API never subscribes to MQTT"), so a
# manual toggle is a request published here and fulfilled by app.worker's
# manual_command_loop, which owns a dedicated aiomqtt connection and calls
# dispatch_command below with rule_id=None — the same nullable column and
# dispatch path a rule firing uses.
MANUAL_COMMAND_CHANNEL = "commands:manual"


class InvalidActuatorError(ValueError):
    """An actuator name that can't be an MQTT topic segment."""

    def __init__(self, actuator: str) -> None:
        super().__init__(f"actuator {actuator!r} is not a valid topic segment")


@dataclass
class _Pace:
    """The last command sent to one actuator, and the value waiting to follow
    it once the minimum interval has passed."""

    last_sent_at: float
    last_value: Any
    pending: tuple[Any, ...] | None = None
    task: asyncio.Task[None] | None = None


# (device_id, actuator) -> pace, in the worker process (both command paths,
# rules and manual, dispatch from there).
_pace: dict[tuple[uuid.UUID, str], _Pace] = {}
_deferred_tasks: set[asyncio.Task[None]] = set()


def reset_pacing() -> None:
    """Forget every actuator's pacing (tests, and a worker restart)."""
    for pace in _pace.values():
        if pace.task is not None:
            pace.task.cancel()
    _pace.clear()


async def dispatch_command(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    rule_id: uuid.UUID | None,
    reading_timestamp: datetime,
    tenant_slug: str,
    device_slug: str,
    actuator: str,
    value: Any,
    command_id: uuid.UUID | None = None,
    requested_by: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """Send a command to one actuator, at most once per
    `actuator_min_interval_seconds` (CLAUDE.md §9 constraint 7: real relays
    are on the other end). Every path goes through here: rules, clear
    actions, "Run now", schedules and manual commands.

    Inside the interval the command is not dropped: the latest value waits and
    is sent when the interval ends, unless by then it equals the value last
    sent (a bounce that settled back), in which case nothing more is sent.
    That way the actuator always ends in the last requested state.

    Returns the command's id when it was published now; None when it was
    folded into a later send. Raises InvalidActuatorError for a name that
    can't be a topic segment. `command_id` is
    normally generated here; a rule firing passes one in so it can record the
    same id on its action_executions row.
    """
    if not is_topic_segment(actuator):
        # Schemas refuse these names; this guards rules saved before they did.
        # A `+`/`#` would make the MQTT client raise, a `/` would publish to
        # another topic and get the worker's shared connection denied.
        raise InvalidActuatorError(actuator)

    args = (
        client,
        factory,
        tenant_id,
        device_id,
        rule_id,
        reading_timestamp,
        tenant_slug,
        device_slug,
        actuator,
        value,
        requested_by,
    )
    key = (device_id, actuator)
    interval = settings.actuator_min_interval_seconds
    now = time.monotonic()
    pace = _pace.get(key)
    if interval > 0 and pace is not None and now - pace.last_sent_at < interval:
        pace.pending = None if value == pace.last_value else args
        if pace.pending is not None and pace.task is None:
            delay = interval - (now - pace.last_sent_at)
            pace.task = asyncio.create_task(_send_pending(key, delay))
            _deferred_tasks.add(pace.task)
            pace.task.add_done_callback(_deferred_tasks.discard)
        log.info(
            "command to device=%s actuator=%s %s (minimum interval %.1fs)",
            device_id,
            actuator,
            "waits for the interval" if pace.pending else "matches the last one sent; not repeated",
            interval,
        )
        return None

    _pace[key] = _Pace(last_sent_at=now, last_value=value)
    return await _publish_command(*args, command_id=command_id)


# Position of `value` in dispatch_command's pacing args tuple.
_VALUE_ARG = 9


async def _send_pending(key: tuple[uuid.UUID, str], delay: float) -> None:
    await asyncio.sleep(delay)
    pace = _pace.get(key)
    if pace is None:
        return
    pace.task = None
    pending, pace.pending = pace.pending, None
    if pending is None:
        return
    pace.last_sent_at = time.monotonic()
    pace.last_value = pending[_VALUE_ARG]
    try:
        await _publish_command(*pending)
    except Exception:
        log.exception("deferred command to device=%s actuator=%s failed", key[0], key[1])


async def _publish_command(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    rule_id: uuid.UUID | None,
    reading_timestamp: datetime,
    tenant_slug: str,
    device_slug: str,
    actuator: str,
    value: Any,
    requested_by: uuid.UUID | None = None,
    command_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Publish now and record the command row. Returns its id."""
    command_id = command_id if command_id is not None else uuid.uuid4()
    issued_at = datetime.now(UTC)
    ttl = settings.command_default_ttl_seconds

    cmd_payload = json.dumps(
        {
            "value": value,
            "issued_at": int(issued_at.timestamp()),
            "ttl": ttl,
            "command_id": str(command_id),
        }
    )
    await client.publish(f"{tenant_slug}/{device_slug}/cmd/{actuator}", cmd_payload, qos=1)

    # Retained desired-state: a device that reconnects converges to the
    # intended state without the platform tracking who missed what
    # (CLAUDE.md §2's documented reconnect boundary).
    state_payload = json.dumps({"value": value})
    await client.publish(
        f"{tenant_slug}/{device_slug}/state/{actuator}", state_payload, qos=1, retain=True
    )

    published_at = datetime.now(UTC)
    latency_ms = (published_at - reading_timestamp).total_seconds() * 1000

    # set_tenant_context is normally only called via tenants.deps once a
    # logged-in user's membership is verified — there's no user here, but the
    # SECURITY DEFINER-backed device resolution that produced this tenant_id
    # (app.ingestion.service.resolve_device_for_topic) is the equivalent trust
    # boundary for a system process instead of a user session.
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        session.add(
            Command(
                id=command_id,
                tenant_id=tenant_id,
                device_id=device_id,
                rule_id=rule_id,
                actuator=actuator,
                value=value,
                issued_at=issued_at,
                ttl_seconds=ttl,
                published_at=published_at,
                latency_ms=latency_ms,
                requested_by=requested_by,
            )
        )
    log.info(
        "command %s dispatched: device=%s actuator=%s latency_ms=%.1f",
        command_id,
        device_id,
        actuator,
        latency_ms,
    )
    return command_id


async def record_ack(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    command_id: uuid.UUID,
) -> None:
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        await session.execute(
            update(Command)
            .where(
                Command.id == command_id,
                Command.tenant_id == tenant_id,
                Command.device_id == device_id,
            )
            .values(acked_at=datetime.now(UTC))
        )
    await realtime_service.publish_event(
        tenant_id,
        {"type": "command_ack", "command_id": str(command_id), "device_id": str(device_id)},
    )


CommandStatusFilter = Literal["confirmed", "pending", "no_response"]


def _commands_filter(
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    actuator: str | None,
    status: CommandStatusFilter | None,
) -> list[ColumnElement[bool]]:
    """The timeline's filters, in SQL so they hold across pages. A command is
    confirmed once acked; otherwise pending until issued_at + ttl, then no
    response (the frontend's lib/command-status.ts, same rule)."""
    where: list[ColumnElement[bool]] = [
        Command.tenant_id == tenant_id,
        Command.device_id == device_id,
    ]
    if actuator:
        where.append(Command.actuator == actuator)
    deadline = Command.issued_at + func.make_interval(0, 0, 0, 0, 0, 0, Command.ttl_seconds)
    if status == "confirmed":
        where.append(Command.acked_at.is_not(None))
    elif status == "pending":
        where.extend([Command.acked_at.is_(None), deadline > func.now()])
    elif status == "no_response":
        where.extend([Command.acked_at.is_(None), deadline <= func.now()])
    return where


async def list_commands(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    *,
    limit: int = 100,
    offset: int = 0,
    actuator: str | None = None,
    status: CommandStatusFilter | None = None,
) -> list[Command]:
    """Newest first; id breaks ties so pages never repeat or skip a row."""
    result = await session.execute(
        select(Command)
        .where(*_commands_filter(tenant_id, device_id, actuator, status))
        .order_by(Command.published_at.desc(), Command.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def count_commands(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    *,
    actuator: str | None = None,
    status: CommandStatusFilter | None = None,
) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Command)
        .where(*_commands_filter(tenant_id, device_id, actuator, status))
    )
    return int(result.scalar_one())


async def request_manual_command(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    device_slug: str,
    actuator: str,
    value: Any,
    requested_by: uuid.UUID | None = None,
) -> None:
    """Publish a manual-command request for app.worker's manual_command_loop
    to fulfil. This writes nothing to the database itself (dispatch_command
    does that once the worker actually publishes), so — unlike
    rules.service._publish_invalidation — there is no commit to race against
    and no need to defer this publish via add_post_commit_callback.
    """
    tenant_slug = await tenants_service.get_tenant_slug(session, tenant_id)
    payload = json.dumps(
        {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "tenant_slug": tenant_slug,
            "device_slug": device_slug,
            "actuator": actuator,
            "value": value,
            "requested_by": str(requested_by) if requested_by else None,
        }
    )
    await redis_client.publish(MANUAL_COMMAND_CHANNEL, payload)


class ExpiredCommand(NamedTuple):
    command_id: uuid.UUID
    tenant_id: uuid.UUID
    device_id: uuid.UUID
    actuator: str
    tenant_slug: str
    device_slug: str
    is_latest: bool
    has_acked_value: bool
    acked_value: Any


async def expire_overdue_commands(
    factory: async_sessionmaker[AsyncSession], now: datetime
) -> list[ExpiredCommand]:
    """Mark every command past its TTL with no ack as expired ("No
    response", stored), across tenants (expire_unacked_commands, SECURITY
    DEFINER: the worker has no tenant context)."""
    async with factory() as session, session.begin():
        result = await session.execute(
            text("SELECT * FROM expire_unacked_commands(:now)"), {"now": now}
        )
        return [ExpiredCommand(**row) for row in result.mappings().all()]


async def restore_desired_state(client: aiomqtt.Client, expired: ExpiredCommand) -> None:
    """A command the device never confirmed must not be applied later, when
    the device reconnects and reads the retained desired state. Put that
    retained state back to the last value the device did confirm, or clear it
    when it never confirmed any. Only for the actuator's latest command: a
    newer one owns the retained state now."""
    if not expired.is_latest:
        return
    topic = f"{expired.tenant_slug}/{expired.device_slug}/state/{expired.actuator}"
    if expired.has_acked_value:
        payload: str | bytes = json.dumps({"value": expired.acked_value})
    else:
        payload = b""  # an empty retained message deletes the retained state
    await client.publish(topic, payload, qos=1, retain=True)
    log.info(
        "command %s expired unconfirmed; desired state of %s %s",
        expired.command_id,
        topic,
        "back to the last confirmed value" if expired.has_acked_value else "cleared",
    )
