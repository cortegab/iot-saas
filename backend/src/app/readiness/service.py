"""Readiness: is the platform actually working, not just "is the API up".

The worker writes a heartbeat to Redis every few seconds (app.worker's
heartbeat_loop). This module reads it, together with the database, Redis and
the telemetry stream's backlog, and says whether anything needs a person. An
external uptime monitor polls GET /health/ready (infra/README.md, Monitoring).
"""

import json
import time
from dataclasses import asdict, dataclass

import redis.asyncio as redis
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

HEARTBEAT_KEY = "worker:heartbeat"
HEARTBEAT_INTERVAL_SECONDS = 10
# The worker is considered down once its heartbeat is this old.
HEARTBEAT_MAX_AGE_SECONDS = 45
# Telemetry waiting to be stored (read but unacknowledged, or not read yet)
# beyond which storage is falling behind.
STREAM_BACKLOG_LIMIT = 50_000
TELEMETRY_STREAM = "telemetry"
WRITER_GROUP = "telemetry-writer"


@dataclass
class Check:
    ok: bool
    detail: str


def heartbeat_check(raw: str | None, now: float) -> Check:
    """Pure: judge the worker's heartbeat blob."""
    if raw is None:
        return Check(False, "no heartbeat: the worker is not running")
    try:
        beat = json.loads(raw)
        age = now - float(beat["ts"])
    except (ValueError, KeyError, TypeError):
        return Check(False, "unreadable heartbeat")
    if age > HEARTBEAT_MAX_AGE_SECONDS:
        return Check(False, f"last heartbeat {age:.0f}s ago")
    if not beat.get("mqtt_connected", False):
        return Check(False, "the worker is not connected to the MQTT broker")
    return Check(True, f"heartbeat {age:.0f}s ago")


def stream_check(groups: list[dict[str, object]]) -> Check:
    """Pure: judge the telemetry writer's backlog from XINFO GROUPS."""
    group = next((g for g in groups if g.get("name") == WRITER_GROUP), None)
    if group is None:
        return Check(True, "no telemetry yet")
    pending = int(str(group.get("pending") or 0))
    lag_raw = group.get("lag")
    lag = int(str(lag_raw)) if lag_raw is not None else 0
    backlog = pending + lag
    if backlog > STREAM_BACKLOG_LIMIT:
        return Check(False, f"{backlog} readings waiting to be stored")
    return Check(True, f"{backlog} readings waiting to be stored")


async def readiness(session: AsyncSession, r: redis.Redis) -> dict[str, object]:
    checks: dict[str, Check] = {}
    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = Check(True, "reachable")
    except (SQLAlchemyError, OSError) as exc:
        checks["database"] = Check(False, f"unreachable: {type(exc).__name__}")
    try:
        await r.ping()
        checks["redis"] = Check(True, "reachable")
        raw = await r.get(HEARTBEAT_KEY)
        checks["worker"] = heartbeat_check(
            raw.decode() if isinstance(raw, bytes) else raw, time.time()
        )
        try:
            groups = await r.xinfo_groups(TELEMETRY_STREAM)
        except redis.ResponseError:
            groups = []  # the stream doesn't exist yet
        checks["telemetry_storage"] = stream_check(groups)
    except redis.RedisError as exc:
        checks["redis"] = Check(False, f"unreachable: {type(exc).__name__}")
    ok = all(c.ok for c in checks.values())
    return {
        "status": "ok" if ok else "failing",
        "checks": {k: asdict(v) for k, v in checks.items()},
    }
