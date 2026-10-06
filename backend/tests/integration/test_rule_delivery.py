"""Integration tests for Phase 4 notification delivery — the deferred email
channel, recipient resolution, and executor saturation. Against the real
iot_test Postgres with a mocked aiomqtt client and a stubbed email provider.
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications.models import Notification
from app.rules import executors
from app.rules import service as rules_service
from app.rules.models import ActionExecution, RuleExecution
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
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": "Sensor 1", "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


async def _create_notify_rule(
    client: httpx.AsyncClient, headers: dict[str, str], device_id: str, *, email: bool
) -> str:
    body = {
        "name": "Notify rule",
        "condition": {
            "kind": "leaf",
            "device_id": device_id,
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": 30.0},
        },
        "actions": [
            {
                "type": "notification",
                "message": "too hot",
                "channels": ["platform", "email"] if email else ["platform"],
            }
        ],
    }
    resp = await client.post("/rules", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(
        select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id))
    )
    return result.scalar_one()


@pytest.fixture
def mock_mqtt_client() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def email_sink(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    sent: list[Any] = []

    class _Provider:
        async def send(self, msg: Any) -> None:
            sent.append(msg)

    monkeypatch.setattr(executors, "get_email_provider", lambda: _Provider())
    return sent


async def _fire(
    client_mqtt: AsyncMock,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: str,
    device: dict[str, Any],
    tenant_slug: str,
) -> None:
    await rules_service.load_rule_cache(factory)
    await rules_service.evaluate_and_dispatch(
        client_mqtt,
        factory,
        uuid.UUID(tenant_id),
        uuid.UUID(device["device"]["id"]),
        tenant_slug,
        device["device"]["slug"],
        "temperature",
        35.0,
        datetime.now(UTC),
    )


async def test_email_channel_sends_and_records(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    owner = await _register(client, "owner-d1@example.com", "AcmeD1")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    await _create_notify_rule(client, headers, device["device"]["id"], email=True)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await _fire(mock_mqtt_client, app_session_factory, tenant_id, device, tenant_slug)

    # Platform notification is written synchronously; email is deferred.
    assert (
        await admin_session.execute(
            select(Notification).where(Notification.device_id == uuid.UUID(device["device"]["id"]))
        )
    ).scalar_one_or_none() is not None
    assert email_sink == []

    await deferred_actions.drain()

    assert len(email_sink) == 1
    assert email_sink[0].to == ["owner-d1@example.com"]  # fallback to the owner
    execution = (await admin_session.execute(select(RuleExecution))).scalar_one()
    email_row = (
        await admin_session.execute(
            select(ActionExecution).where(
                ActionExecution.rule_execution_id == execution.id,
                ActionExecution.action_type == "email",
            )
        )
    ).scalar_one()
    assert email_row.status == "success"
    assert email_row.detail == {"recipients_count": 1, "attempts": 1}


async def test_email_recipients_fallback_excludes_viewers(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    owner = await _register(client, "owner-d2@example.com", "AcmeD2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    await _register(client, "admin-d2@example.com", "AdminHome2")
    await _register(client, "viewer-d2@example.com", "ViewerHome2")
    await client.post(
        "/tenants/members", json={"email": "admin-d2@example.com", "role": "admin"}, headers=headers
    )
    await client.post(
        "/tenants/members",
        json={"email": "viewer-d2@example.com", "role": "viewer"},
        headers=headers,
    )
    device = await _create_device(client, headers)
    await _create_notify_rule(client, headers, device["device"]["id"], email=True)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await _fire(mock_mqtt_client, app_session_factory, tenant_id, device, tenant_slug)
    await deferred_actions.drain()

    assert set(email_sink[0].to) == {"owner-d2@example.com", "admin-d2@example.com"}


async def test_explicit_recipient_list_wins(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    owner = await _register(client, "owner-d3@example.com", "AcmeD3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    resp = await client.patch(
        "/tenants/current",
        json={"notification_emails": ["ops@acme.com", "sre@acme.com"]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["notification_emails"] == ["ops@acme.com", "sre@acme.com"]
    device = await _create_device(client, headers)
    await _create_notify_rule(client, headers, device["device"]["id"], email=True)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    await _fire(mock_mqtt_client, app_session_factory, tenant_id, device, tenant_slug)
    await deferred_actions.drain()

    assert email_sink[0].to == ["ops@acme.com", "sre@acme.com"]


async def test_no_recipients_records_failed(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    deferred_actions: Any,
    email_sink: list[Any],
) -> None:
    owner = await _register(client, "owner-d4@example.com", "AcmeD4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    await _create_notify_rule(client, headers, device["device"]["id"], email=True)
    tenant_slug = await _tenant_slug(admin_session, tenant_id)
    # Strip every membership so the fallback resolver finds no one.
    await admin_session.execute(
        text("DELETE FROM tenant_memberships WHERE tenant_id = :t"), {"t": tenant_id}
    )
    await admin_session.commit()

    await _fire(mock_mqtt_client, app_session_factory, tenant_id, device, tenant_slug)
    await deferred_actions.drain()

    assert email_sink == []
    execution = (await admin_session.execute(select(RuleExecution))).scalar_one()
    email_row = (
        await admin_session.execute(
            select(ActionExecution).where(
                ActionExecution.rule_execution_id == execution.id,
                ActionExecution.action_type == "email",
            )
        )
    ).scalar_one()
    assert email_row.status == "failed"
    assert email_row.detail == {"reason": "no_recipients"}


async def test_executor_saturation_records_failed_inline(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
    mock_mqtt_client: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _register(client, "owner-d5@example.com", "AcmeD5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device = await _create_device(client, headers)
    body = {
        "name": "Webhook rule",
        "condition": {
            "kind": "leaf",
            "device_id": device["device"]["id"],
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": 30.0},
        },
        "actions": [{"type": "webhook", "url": "https://x/h", "body": {}}],
    }
    assert (await client.post("/rules", json=body, headers=headers)).status_code == 201
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    # A 0-permit semaphore is always "locked" — every deferred descriptor is
    # recorded as failed inline rather than spawned.
    monkeypatch.setattr(rules_service, "_DEFERRED_SEMAPHORE", asyncio.Semaphore(0))
    spawn = AsyncMock()
    monkeypatch.setattr(rules_service, "_spawn_deferred", spawn)

    await _fire(mock_mqtt_client, app_session_factory, tenant_id, device, tenant_slug)

    spawn.assert_not_called()
    execution = (await admin_session.execute(select(RuleExecution))).scalar_one()
    webhook_row = (
        await admin_session.execute(
            select(ActionExecution).where(
                ActionExecution.rule_execution_id == execution.id,
                ActionExecution.action_type == "webhook",
            )
        )
    ).scalar_one()
    assert webhook_row.status == "failed"
    assert webhook_row.detail == {"reason": "executor_saturated"}
