"""Redis pub/sub channel ownership for live updates. Other modules
(ingestion, commands) publish through `publish_event` here rather than each
inventing their own channel name — the same ownership pattern
rules/service.py uses for RULES_INVALIDATE_CHANNEL.
"""

import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.auth import service as auth_service
from app.redis import redis_client
from app.tenants import service as tenants_service

REALTIME_CHANNEL_PREFIX = "realtime:"


def channel_for(tenant_id: uuid.UUID) -> str:
    return f"{REALTIME_CHANNEL_PREFIX}{tenant_id}"


async def publish_event(tenant_id: uuid.UUID, event: dict[str, Any]) -> None:
    """Fire-and-forget — a dropped or delayed live-update event never blocks
    the caller (both current callers, ingestion.service.record_telemetry_direct
    and commands.service.record_ack, have already done their real work by the
    time this runs).
    """
    await redis_client.publish(channel_for(tenant_id), json.dumps(event))


class RealtimeAuthError(Exception):
    pass


class InvalidTokenError(RealtimeAuthError):
    pass


class NotAMemberError(RealtimeAuthError):
    pass


async def authenticate(session: AsyncSession, token: str, tenant_id: uuid.UUID) -> uuid.UUID:
    """The WebSocket handshake's auth check, factored out of realtime/router.py
    so it's testable as a plain async function against a real session/DB —
    the same way rules/commands service functions are tested — rather than
    needing a full WebSocket test transport (which, empirically, doesn't mix
    cleanly with this project's async engine fixtures: a WS TestClient runs
    the ASGI app on a separate thread/event loop, and asyncpg connections are
    bound to the loop that created them).
    """
    try:
        user_id = auth_service.decode_access_token(token)
    except auth_service.InvalidAccessTokenError as exc:
        raise InvalidTokenError from exc
    await db.set_user_context(session, user_id)
    if await tenants_service.verify_membership(session, user_id, tenant_id) is None:
        raise NotAMemberError
    return user_id
