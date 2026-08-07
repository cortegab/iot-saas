"""The live-updates WebSocket endpoint.

Browsers can't set custom headers on a native WebSocket handshake, so auth
comes via query params instead of the Authorization/X-Tenant-Id headers
tenants.deps.require_tenant_context reads for every HTTP route — but
realtime.service.authenticate calls the same service functions HTTP auth
uses underneath.

Deliberately does NOT use Depends(get_session): that dependency wraps its
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
from app.realtime import service as realtime_service
from app.redis import redis_client

log = logging.getLogger("realtime")

router = APIRouter(tags=["realtime"])


async def _relay(pubsub: PubSub, websocket: WebSocket) -> None:
    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        await websocket.send_text(message["data"])


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
        relay_task = asyncio.create_task(_relay(pubsub, websocket))
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
