"""Integration tests for the realtime module: the WebSocket handshake's auth
check, and the two publish call sites (ingestion, commands).

The auth check (realtime.service.authenticate) is tested directly as a plain
async function against a real session/DB, not through a WebSocket test
transport — empirically, a WS TestClient runs the ASGI app on a separate
thread with its own event loop, and this project's async engine fixtures'
asyncpg connections are bound to whichever loop created them, so the two
don't mix (confirmed: it raises "Future attached to a different loop").
Testing the pure auth logic directly and trusting FastAPI's own
accept()/close() mechanics is the same principle already applied elsewhere
in this suite (e.g. rules/commands service functions tested directly rather
than through a fake MQTT client).
"""

import base64
import json
import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands import service as commands_service
from app.realtime import service as realtime_service


async def _register(client: httpx.AsyncClient, email: str, tenant_name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": tenant_name},
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


def _auth_headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def test_authenticate_rejects_invalid_token(
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with app_session_factory() as session, session.begin():
        with pytest.raises(realtime_service.InvalidTokenError):
            await realtime_service.authenticate(session, "garbage", uuid.uuid4())


async def test_authenticate_rejects_non_member_tenant(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")

    async with app_session_factory() as session, session.begin():
        with pytest.raises(realtime_service.NotAMemberError):
            await realtime_service.authenticate(session, owner["access_token"], uuid.uuid4())


async def test_authenticate_accepts_valid_member(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])

    async with app_session_factory() as session, session.begin():
        user_id = await realtime_service.authenticate(session, owner["access_token"], tenant_id)
    assert user_id is not None


async def test_ingest_publishes_realtime_telemetry_event(
    client: httpx.AsyncClient, _mock_redis_publish: Any
) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await client.post("/devices", json={"name": "Sensor 1"}, headers=headers)
    username = device.json()["credential"]["username"]
    password = device.json()["credential"]["password"]

    basic = base64.b64encode(f"{username}:{password}".encode()).decode()
    resp = await client.post(
        "/ingest",
        json={"metric": "temperature", "value": 31.5},
        headers={"authorization": f"Basic {basic}"},
    )
    assert resp.status_code == 202

    calls = [c for c in _mock_redis_publish.call_args_list if c.args[0] == f"realtime:{tenant_id}"]
    assert len(calls) == 1
    event = json.loads(calls[0].args[1])
    assert event["type"] == "telemetry"
    assert event["metric"] == "temperature"
    assert event["value"] == 31.5


async def test_ack_publishes_realtime_command_ack_event(
    app_session_factory: async_sessionmaker[AsyncSession],
    _mock_redis_publish: Any,
) -> None:
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()
    command_id = uuid.uuid4()

    await commands_service.record_ack(app_session_factory, tenant_id, device_id, command_id)

    calls = [
        c
        for c in _mock_redis_publish.call_args_list
        if c.args[0] == realtime_service.channel_for(tenant_id)
    ]
    assert len(calls) == 1
    event = json.loads(calls[0].args[1])
    assert event == {"type": "command_ack", "command_id": str(command_id), "device_id": str(device_id)}
