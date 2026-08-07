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

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import aiomqtt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands.models import Command
from app.config import settings
from app.db import set_tenant_context
from app.realtime import service as realtime_service
from app.redis import redis_client
from app.tenants import service as tenants_service

log = logging.getLogger("commands")

# Dashboard-triggered manual commands (Phase 4): the API process holds no MQTT
# client of its own (CLAUDE.md §2 — "the API never subscribes to MQTT"), so a
# manual toggle is a request published here and fulfilled by app.worker's
# manual_command_loop, which owns a dedicated aiomqtt connection and calls
# dispatch_command below with rule_id=None — the same nullable column and
# dispatch path a rule firing uses.
MANUAL_COMMAND_CHANNEL = "commands:manual"


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
) -> None:
    command_id = uuid.uuid4()
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
            )
        )
    log.info(
        "command %s dispatched: device=%s actuator=%s latency_ms=%.1f",
        command_id,
        device_id,
        actuator,
        latency_ms,
    )


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


async def list_commands(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> list[Command]:
    result = await session.execute(
        select(Command)
        .where(Command.tenant_id == tenant_id, Command.device_id == device_id)
        .order_by(Command.published_at.desc())
        .limit(100)
    )
    return list(result.scalars().all())


async def request_manual_command(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    device_slug: str,
    actuator: str,
    value: Any,
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
        }
    )
    await redis_client.publish(MANUAL_COMMAND_CHANNEL, payload)
