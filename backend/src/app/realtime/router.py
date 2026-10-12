"""The live-updates WebSocket endpoint.

Browsers can't set custom headers on a native WebSocket handshake, so auth
comes via query params instead of the Authorization/X-Tenant-Id headers
tenants.deps.require_tenant_context reads for every HTTP route — but
realtime.service.authenticate calls the same service functions HTTP auth
uses underneath.

Deliberately does NOT use Depends(get_session, scope="function"): that dependency wraps its
session in a transaction for the lifetime of the route handler
(app/db.py's get_session docstring), which for a WebSocket route would hold
a pooled connection open for as long as the socket stays connected — for
what might be hours per browser tab. Instead a short-lived session (via
db.session_factory directly) does just the one-time auth check, and is
closed before the long-lived relay loop starts.
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio.client import PubSub

from app import db
from app.config import settings
from app.realtime import service as realtime_service
from app.redis import redis_client

log = logging.getLogger("realtime")

router = APIRouter(tags=["realtime"])


def batch_frame(events: list[str]) -> str:
    """One WS frame for a tick's worth of events. Each event is already a JSON
    object string (realtime.service.publish_event's json.dumps), so they're
    joined rather than re-parsed; a lone event goes out unwrapped, in its
    original shape."""
    if len(events) == 1:
        return events[0]
    return '{"type":"batch","events":[' + ",".join(events) + "]}"


async def _relay(pubsub: PubSub, websocket: WebSocket, interval_s: float) -> None:
    """Coalesces the tenant's events into at most one frame per `interval_s`
    (docs/plans/web-realtime.md): a device publishing 20x/s used to cost every
    open tab 20 frames/s. Every event is kept — charts still get each point."""
    pending: list[str] = []

    async def collect() -> None:
        async for message in pubsub.listen():
            if message["type"] == "message":
                pending.append(message["data"])

    collector = asyncio.create_task(collect())
    try:
        while not collector.done():
            await asyncio.sleep(interval_s)
            if pending:
                events = pending.copy()
                pending.clear()
                await websocket.send_text(batch_frame(events))
        collector.result()
    finally:
        collector.cancel()


@router.websocket("/ws")
async def realtime_ws(websocket: WebSocket, token: str, tenant_id: uuid.UUID) -> None:
    async with db.session_factory() as session, session.begin():
        try:
            user_id = await realtime_service.authenticate(session, token, tenant_id)
        except realtime_service.InvalidTokenError:
            await websocket.close(code=4401)
            return
        except realtime_service.NotAMemberError:
            await websocket.close(code=4403)
            return

    await websocket.accept()
    log.info("realtime connection opened: tenant=%s user=%s", tenant_id, user_id)
    async with redis_client.pubsub() as pubsub:
        await pubsub.subscribe(realtime_service.channel_for(tenant_id))
        relay_task = asyncio.create_task(
            _relay(pubsub, websocket, settings.realtime_flush_interval_ms / 1000)
        )
        try:
            while True:
                # Nothing meaningful arrives from the client — this loop
                # exists only to notice a client-initiated close.
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            relay_task.cancel()
            log.info("realtime connection closed: tenant=%s user=%s", tenant_id, user_id)
