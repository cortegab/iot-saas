"""Integration tests for the HTTP ingest fallback and EMQX auth/authz
callbacks — against the real FastAPI app and iot_test Postgres.

The ingest endpoint pushes onto the same Redis stream the live dev worker
container drains (app/redis.py's shared client) — conftest.py's autouse
`_mock_redis_xadd` fixture keeps every test here from actually reaching
Redis. Without that, test telemetry referencing iot_test-only tenant/device
ids would land in the *dev* worker's queue and fail its FK-constrained insert
against the dev database, an entirely different Postgres instance from
iot_test.
"""

import base64
import uuid
from typing import Any
from unittest.mock import AsyncMock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.tenants.models import Tenant

EMQX_HEADERS = {"x-emqx-auth-secret": settings.emqx_auth_shared_secret.get_secret_value()}


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


async def _create_device(
    client: httpx.AsyncClient, headers: dict[str, str], name: str
) -> dict[str, Any]:
    catalog_entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": name, "catalog_entry_id": catalog_entry_id}, headers=headers
    )
    assert resp.status_code == 201
    result: dict[str, Any] = resp.json()
    return result


def _basic_auth_header(username: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"authorization": f"Basic {token}"}


async def _tenant_slug(admin_session: AsyncSession, tenant_id: str) -> str:
    result = await admin_session.execute(select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id)))
    return result.scalar_one()


async def test_ingest_with_valid_credentials_accepted(
    client: httpx.AsyncClient, _mock_redis_xadd: AsyncMock
) -> None:
    owner = await _register(client, "owner@example.com", "Acme")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    username = created["credential"]["username"]
    password = created["credential"]["password"]

    resp = await client.post(
        "/ingest",
        json={"metric": "temperature", "value": 21.5},
        headers=_basic_auth_header(username, password),
    )
    assert resp.status_code == 202
    _mock_redis_xadd.assert_awaited_once()


async def test_ingest_with_wrong_password_rejected(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner2@example.com", "Acme2")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    username = created["credential"]["username"]

    resp = await client.post(
        "/ingest",
        json={"metric": "temperature", "value": 21.5},
        headers=_basic_auth_header(username, "wrong-password"),
    )
    assert resp.status_code == 401


async def test_ingest_disabled_device_rejected(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner3@example.com", "Acme3")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    device_id = created["device"]["id"]
    username = created["credential"]["username"]
    password = created["credential"]["password"]

    disable = await client.patch(
        f"/devices/{device_id}", json={"status": "disabled"}, headers=headers
    )
    assert disable.status_code == 200

    resp = await client.post(
        "/ingest",
        json={"metric": "temperature", "value": 21.5},
        headers=_basic_auth_header(username, password),
    )
    assert resp.status_code == 401


async def test_ingest_missing_credentials_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.post("/ingest", json={"metric": "temperature", "value": 1.0})
    assert resp.status_code == 401


async def test_ingest_malformed_body_rejected(client: httpx.AsyncClient) -> None:
    # Missing required `value` — Pydantic/FastAPI validation, never a 500
    # (MQTT payloads and the HTTP fallback body are untrusted input).
    resp = await client.post("/ingest", json={"metric": "temperature"})
    assert resp.status_code == 422


async def test_emqx_authenticate_requires_shared_secret(client: httpx.AsyncClient) -> None:
    resp = await client.post("/ingestion/emqx/authenticate", json={"username": "x", "password": "y"})
    assert resp.status_code == 401


async def test_emqx_authenticate_valid_device_allowed(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner4@example.com", "Acme4")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    username = created["credential"]["username"]
    password = created["credential"]["password"]

    resp = await client.post(
        "/ingestion/emqx/authenticate",
        json={"username": username, "password": password},
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "allow"


async def test_emqx_authenticate_wrong_password_denied(client: httpx.AsyncClient) -> None:
    owner = await _register(client, "owner5@example.com", "Acme5")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    username = created["credential"]["username"]

    resp = await client.post(
        "/ingestion/emqx/authenticate",
        json={"username": username, "password": "wrong"},
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "deny"


async def test_emqx_authenticate_unknown_username_denied(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/ingestion/emqx/authenticate",
        json={"username": "00000000-0000-0000-0000-000000000000", "password": "x"},
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "deny"


async def test_emqx_authenticate_worker_system_credential_allowed(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/ingestion/emqx/authenticate",
        json={
            "username": settings.mqtt_worker_username,
            "password": settings.mqtt_worker_password.get_secret_value(),
        },
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "allow"


async def test_emqx_authenticate_worker_wrong_password_denied(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/ingestion/emqx/authenticate",
        json={"username": settings.mqtt_worker_username, "password": "wrong"},
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "deny"


async def test_emqx_authorize_device_own_subtree_allowed(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner6@example.com", "Acme6")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    created = await _create_device(client, headers, "Sensor 1")
    username = created["credential"]["username"]
    device_slug = created["device"]["slug"]
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    resp = await client.post(
        "/ingestion/emqx/authorize",
        json={
            "username": username,
            "topic": f"{tenant_slug}/{device_slug}/temperature",
            "action": "publish",
        },
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "allow"


async def test_emqx_authorize_cross_device_topic_denied(
    client: httpx.AsyncClient, admin_session: AsyncSession
) -> None:
    owner = await _register(client, "owner7@example.com", "Acme7")
    tenant_id = owner["memberships"][0]["tenant_id"]
    headers = _auth_headers(owner, tenant_id)
    device_a = await _create_device(client, headers, "Sensor A")
    device_b = await _create_device(client, headers, "Sensor B")
    username_a = device_a["credential"]["username"]
    slug_b = device_b["device"]["slug"]
    tenant_slug = await _tenant_slug(admin_session, tenant_id)

    resp = await client.post(
        "/ingestion/emqx/authorize",
        json={
            "username": username_a,
            "topic": f"{tenant_slug}/{slug_b}/temperature",
            "action": "publish",
        },
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "deny"


async def test_emqx_authorize_worker_subscribe_only(client: httpx.AsyncClient) -> None:
    allowed = await client.post(
        "/ingestion/emqx/authorize",
        json={"username": settings.mqtt_worker_username, "topic": "+/+/+", "action": "subscribe"},
        headers=EMQX_HEADERS,
    )
    assert allowed.status_code == 200
    assert allowed.json()["result"] == "allow"

    denied = await client.post(
        "/ingestion/emqx/authorize",
        json={
            "username": settings.mqtt_worker_username,
            "topic": "acme/sensor-1/temperature",
            "action": "publish",
        },
        headers=EMQX_HEADERS,
    )
    assert denied.status_code == 200
    assert denied.json()["result"] == "deny"
