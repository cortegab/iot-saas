"""Commands past their TTL with no ack (worker.command_expiry_loop):
"No response" is stored, the retained desired state goes back to the last
value the device confirmed (or is cleared), and only the actuator's latest
command does that. Also: a manual command records who sent it."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands import service as commands_service


async def _setup(client: httpx.AsyncClient, email: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": "Exp"},
    )
    body: dict[str, Any] = resp.json()
    tenant_id = body["memberships"][0]["tenant_id"]
    headers = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}
    entry = await client.post(
        "/catalog",
        json={"name": "Fan box", "actuators": [{"name": "Fan", "key": "fan"}]},
        headers=headers,
    )
    device = await client.post(
        "/devices", json={"name": "Bay 1", "catalog_entry_id": entry.json()["id"]}, headers=headers
    )
    me = (await client.get("/auth/me", headers=headers)).json()
    return {
        "tenant_id": tenant_id,
        "headers": headers,
        "device": device.json()["device"],
        "tenant_slug": device.json()["tenant_slug"],
        "user_id": me["id"],
    }


async def _command(
    admin_session: AsyncSession,
    ctx: dict[str, Any],
    value: Any,
    issued_ago_s: float,
    acked: bool = False,
) -> uuid.UUID:
    command_id = uuid.uuid4()
    issued = datetime.now(UTC) - timedelta(seconds=issued_ago_s)
    await admin_session.execute(
        text(
            "INSERT INTO commands (id, tenant_id, device_id, actuator, value, issued_at, "
            "ttl_seconds, published_at, acked_at, latency_ms) VALUES (:id, :t, :d, 'fan', "
            "CAST(:v AS jsonb), :i, 30, :i, :a, 1.0)"
        ),
        {
            "id": command_id,
            "t": uuid.UUID(ctx["tenant_id"]),
            "d": uuid.UUID(ctx["device"]["id"]),
            "v": json.dumps(value),
            "i": issued,
            "a": issued + timedelta(seconds=1) if acked else None,
        },
    )
    await admin_session.commit()
    return command_id


async def test_overdue_command_expires_and_state_goes_back_to_the_confirmed_value(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    ctx = await _setup(client, "exp1@example.com")
    await _command(admin_session, ctx, True, issued_ago_s=600, acked=True)
    late = await _command(admin_session, ctx, False, issued_ago_s=60)
    fresh_device_ok = await _command(admin_session, ctx, False, issued_ago_s=5)  # within TTL

    expired = await commands_service.expire_overdue_commands(app_session_factory, datetime.now(UTC))

    assert [e.command_id for e in expired] == [late]
    e = expired[0]
    assert e.is_latest is False  # the 5-second-old command came after it
    assert e.has_acked_value and e.acked_value is True
    stored = await admin_session.execute(
        text("SELECT id FROM commands WHERE expired_at IS NOT NULL")
    )
    assert [r[0] for r in stored] == [late]
    assert fresh_device_ok != late


async def test_latest_unconfirmed_command_restores_the_retained_state(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    ctx = await _setup(client, "exp2@example.com")
    await _command(admin_session, ctx, True, issued_ago_s=600, acked=True)
    await _command(admin_session, ctx, False, issued_ago_s=60)

    [expired] = await commands_service.expire_overdue_commands(
        app_session_factory, datetime.now(UTC)
    )
    mqtt = AsyncMock()
    await commands_service.restore_desired_state(mqtt, expired)

    topic = f"{ctx['tenant_slug']}/{ctx['device']['slug']}/state/fan"
    mqtt.publish.assert_awaited_once_with(topic, json.dumps({"value": True}), qos=1, retain=True)


async def test_never_confirmed_actuator_has_its_retained_state_cleared(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    ctx = await _setup(client, "exp3@example.com")
    await _command(admin_session, ctx, True, issued_ago_s=60)

    [expired] = await commands_service.expire_overdue_commands(
        app_session_factory, datetime.now(UTC)
    )
    mqtt = AsyncMock()
    await commands_service.restore_desired_state(mqtt, expired)

    mqtt.publish.assert_awaited_once()
    assert mqtt.publish.await_args.args[1] == b""
    assert mqtt.publish.await_args.kwargs["retain"] is True


async def test_expiry_runs_once_per_command(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    ctx = await _setup(client, "exp4@example.com")
    await _command(admin_session, ctx, True, issued_ago_s=60)

    first = await commands_service.expire_overdue_commands(app_session_factory, datetime.now(UTC))
    again = await commands_service.expire_overdue_commands(app_session_factory, datetime.now(UTC))

    assert len(first) == 1
    assert again == []


async def test_manual_command_request_names_who_sent_it(
    client: httpx.AsyncClient, _mock_redis_publish: AsyncMock
) -> None:
    ctx = await _setup(client, "exp5@example.com")
    _mock_redis_publish.reset_mock()

    resp = await client.post(
        f"/devices/{ctx['device']['id']}/commands",
        json={"actuator": "fan", "value": True},
        headers=ctx["headers"],
    )

    assert resp.status_code == 202
    [call] = [
        c
        for c in _mock_redis_publish.call_args_list
        if c.args[0] == commands_service.MANUAL_COMMAND_CHANNEL
    ]
    assert json.loads(call.args[1])["requested_by"] == ctx["user_id"]
