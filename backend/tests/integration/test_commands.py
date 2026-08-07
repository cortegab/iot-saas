"""Integration tests for app.rules.service.evaluate_and_dispatch and
app.commands.service — against the real iot_test Postgres, with a mocked
aiomqtt.Client (no real broker in tests, same approach test_ingestion.py
used for Redis).
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker
from app.commands import service as commands_service
from app.commands.models import Command
from app.notifications.models import Notification
from app.rules import service as rules_service
from app.tenants.models import Tenant


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


async def _create_device(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    resp = await client.post("/devices", json={"name": "Sensor 1"}, headers=headers)
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _create_rule(
    client: httpx.AsyncClient, headers: dict[str, str], device_id: str, **overrides: Any
) -> dict[str, Any]:
    body = {
        "metric": "temperature",
        "operator": ">",
        "threshold": 30.0,
        "action": {"type": "actuator_command", "actuator": "fan1", "value": True},
        **overrides,
    }
    resp = await client.post(f"/devices/{device_id}/rules", json=body, headers=headers)
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id)))
    return result.scalar_one()


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


async def test_evaluate_and_dispatch_fires_actuator_command(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner1@example.com", "Acme1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    await _create_rule(client, headers, device_id)

    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device_slug,
        "temperature",
        35.0,
        datetime.now(UTC),
    )

    assert mock_mqtt_client.publish.call_count == 2
    cmd_call, state_call = mock_mqtt_client.publish.call_args_list
    assert cmd_call.args[0] == f"{tenant_slug}/{device_slug}/cmd/fan1"
    assert cmd_call.kwargs["qos"] == 1
    assert state_call.args[0] == f"{tenant_slug}/{device_slug}/state/fan1"
    assert state_call.kwargs.get("retain") is True

    result = await admin_session.execute(
        select(Command).where(Command.device_id == uuid.UUID(device_id))
    )
    command = result.scalar_one()
    assert command.actuator == "fan1"
    assert command.value is True
    assert command.latency_ms >= 0
    assert command.acked_at is None

    # A notification row is written for every firing, not only
    # notification-typed actions (see test_notification_action_creates_notification_row).
    notification_result = await admin_session.execute(
        select(Notification).where(Notification.device_id == uuid.UUID(device_id))
    )
    notification = notification_result.scalar_one()
    assert "temperature" in notification.message
    assert notification.read_at is None


async def test_dispatch_command_and_record_ack(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = uuid.UUID(owner["memberships"][0]["tenant_id"])
    headers = _auth_headers(owner, str(tenant_id))
    device = await _create_device(client, headers)
    device_id = uuid.UUID(device["device"]["id"])
    device_slug = device["device"]["slug"]
    tenant_slug = await _tenant_slug(admin_session, str(tenant_id))
    rule = await _create_rule(client, headers, str(device_id))
    rule_id = uuid.UUID(rule["id"])

    await commands_service.dispatch_command(
        mock_mqtt_client,
        app_session_factory,
        tenant_id,
        device_id,
        rule_id,
        datetime.now(UTC),
        tenant_slug,
        device_slug,
        actuator="fan1",
        value=True,
    )

    result = await admin_session.execute(select(Command).where(Command.device_id == device_id))
    command = result.scalar_one()
    assert command.acked_at is None

    await commands_service.record_ack(app_session_factory, tenant_id, device_id, command.id)

    await admin_session.refresh(command)
    assert command.acked_at is not None


async def test_webhook_action_posts_to_url(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    await _create_rule(
        client,
        headers,
        device_id,
        action={"type": "webhook", "url": "https://example.com/hook", "body": {"foo": "bar"}},
    )
    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    mock_post = AsyncMock()
    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device_slug,
        "temperature",
        35.0,
        datetime.now(UTC),
    )

    mock_post.assert_awaited_once()
    assert mock_post.call_args.args[0] == "https://example.com/hook"
    assert mock_post.call_args.kwargs["json"] == {"foo": "bar"}
    mock_mqtt_client.publish.assert_not_called()


async def test_manual_command_publishes_request_as_admin(
    client: httpx.AsyncClient,
    _mock_redis_publish: AsyncMock,
) -> None:
    owner = await _register(client, "owner9@example.com", "Acme9")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]

    resp = await client.post(
        f"/devices/{device_id}/commands",
        json={"actuator": "fan1", "value": True},
        headers=headers,
    )
    assert resp.status_code == 202

    _mock_redis_publish.assert_awaited_once()
    channel, payload = _mock_redis_publish.call_args.args
    assert channel == commands_service.MANUAL_COMMAND_CHANNEL
    data = json.loads(payload)
    assert data["device_id"] == device_id
    assert data["device_slug"] == device_slug
    assert data["actuator"] == "fan1"
    assert data["value"] is True


async def test_manual_command_viewer_forbidden(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner10@example.com", "Acme10")
    tenant_id = owner["memberships"][0]["tenant_id"]
    owner_headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, owner_headers)

    viewer = await _register(client, "viewer10@example.com", "ViewerOwnTenant10")
    await client.post(
        "/tenants/members",
        json={"email": "viewer10@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    viewer_headers = _auth_headers(viewer, tenant_id)

    resp = await client.post(
        f"/devices/{device['device']['id']}/commands",
        json={"actuator": "fan1", "value": True},
        headers=viewer_headers,
    )
    assert resp.status_code == 403


async def test_manual_command_disabled_device_conflict(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner11@example.com", "Acme11")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]

    await client.patch(f"/devices/{device_id}", json={"status": "disabled"}, headers=headers)

    resp = await client.post(
        f"/devices/{device_id}/commands",
        json={"actuator": "fan1", "value": True},
        headers=headers,
    )
    assert resp.status_code == 409


async def test_manual_command_loop_dispatches_with_no_rule(
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    client: httpx.AsyncClient,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner12@example.com", "Acme12")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    raw = json.dumps(
        {
            "tenant_id": tenant_id,
            "device_id": device_id,
            "tenant_slug": tenant_slug,
            "device_slug": device_slug,
            "actuator": "fan1",
            "value": True,
        }
    )

    await worker._handle_manual_command(mock_mqtt_client, app_session_factory, raw)

    mock_mqtt_client.publish.assert_called()
    result = await admin_session.execute(
        select(Command).where(Command.device_id == uuid.UUID(device_id))
    )
    command = result.scalar_one()
    assert command.rule_id is None
    assert command.actuator == "fan1"


async def test_manual_command_loop_drops_malformed_payload(
    app_session_factory: async_sessionmaker[AsyncSession],
    mock_mqtt_client: AsyncMock,
) -> None:
    await worker._handle_manual_command(mock_mqtt_client, app_session_factory, "not json")
    await worker._handle_manual_command(mock_mqtt_client, app_session_factory, json.dumps({}))

    mock_mqtt_client.publish.assert_not_called()


async def test_notification_action_creates_notification_row(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    await _create_rule(
        client, headers, device_id, action={"type": "notification", "message": "temp too high"}
    )
    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device_slug,
        "temperature",
        35.0,
        datetime.now(UTC),
    )

    mock_mqtt_client.publish.assert_not_called()
    result = await admin_session.execute(
        select(Command).where(Command.device_id == uuid.UUID(device_id))
    )
    assert result.scalar_one_or_none() is None

    # notification-type actions use their configured message verbatim,
    # unlike the auto-generated message every other action type gets.
    notification_result = await admin_session.execute(
        select(Notification).where(Notification.device_id == uuid.UUID(device_id))
    )
    notification = notification_result.scalar_one()
    assert notification.message == "temp too high"


async def test_disabled_rule_excluded_from_cache(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    device_id = device["device"]["id"]
    device_slug = device["device"]["slug"]
    created = await _create_rule(client, headers, device_id)

    await client.patch(f"/rules/{created['id']}", json={"enabled": False}, headers=headers)
    await rules_service.load_rule_cache(app_session_factory)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await rules_service.evaluate_and_dispatch(
        mock_mqtt_client,
        app_session_factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device_id),
        tenant_slug,
        device_slug,
        "temperature",
        35.0,
        datetime.now(UTC),
    )

    mock_mqtt_client.publish.assert_not_called()
