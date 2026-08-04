"""Integration tests for app.rules.service.evaluate_and_dispatch and
app.commands.service — against the real iot_test Postgres, with a mocked
aiomqtt.Client (no real broker in tests, same approach test_ingestion.py
used for Redis).
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands import service as commands_service
from app.commands.models import Command
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


async def test_notification_action_is_stub_only(
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
