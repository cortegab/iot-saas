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
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.ingestion.service import (
    HTTP_INGEST_PER_MINUTE,
    HTTP_READING_CHANNEL,
    allow_http_reading,
)
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
    result = await admin_session.execute(
        select(Tenant.slug).where(Tenant.id == uuid.UUID(tenant_id))
    )
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
    resp = await client.post(
        "/ingestion/emqx/authenticate", json={"username": "x", "password": "y"}
    )
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


async def test_emqx_authenticate_worker_system_credential_allowed(
    client: httpx.AsyncClient,
) -> None:
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


@pytest.mark.parametrize(
    "topic,expected",
    [
        ("acme/sensor-1/cmd/fan1", "allow"),
        ("acme/sensor-1/state/fan1", "allow"),
        # Regression: the retained telemetry profile (app/worker.py's
        # _handle_config_publish) was denied, so no device ever received it.
        ("acme/sensor-1/config", "allow"),
        # Over-the-air update requests (app.firmware).
        ("acme/sensor-1/ota", "allow"),
        ("acme/sensor-1/temperature", "deny"),
        ("acme/sensor-1/status", "deny"),
        ("acme//config", "deny"),
        ("acme/sensor-1/config/extra", "deny"),
    ],
)
async def test_emqx_authorize_worker_publish_topics(
    client: httpx.AsyncClient, topic: str, expected: str
) -> None:
    resp = await client.post(
        "/ingestion/emqx/authorize",
        json={"username": settings.mqtt_worker_username, "topic": topic, "action": "publish"},
        headers=EMQX_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == expected


async def test_ingest_hands_the_reading_to_the_worker_for_rules(
    client: httpx.AsyncClient, _mock_redis_publish: AsyncMock
) -> None:
    owner = await _register(client, "http-rules@example.com", "HttpRules")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await _create_device(client, headers, "Sensor 1")
    _mock_redis_publish.reset_mock()

    resp = await client.post(
        "/ingest",
        json={"metric": "temperature", "value": 31.5},
        headers=_basic_auth_header(
            created["credential"]["username"], created["credential"]["password"]
        ),
    )

    assert resp.status_code == 202
    calls = [c for c in _mock_redis_publish.call_args_list if c.args[0] == HTTP_READING_CHANNEL]
    assert len(calls) == 1
    data = json.loads(calls[0].args[1])
    assert data["device_id"] == created["device"]["id"]
    assert data["device_slug"] == created["device"]["slug"]
    assert data["metric"] == "temperature"
    assert data["value"] == 31.5


@pytest.mark.parametrize("metric", ["status", "config", "OTA", "a/b", "temp#"])
async def test_ingest_refuses_reserved_and_topic_breaking_metrics(
    client: httpx.AsyncClient, metric: str
) -> None:
    owner = await _register(client, f"http-res-{abs(hash(metric))}@example.com", "HttpRes")
    headers = _auth_headers(owner, owner["memberships"][0]["tenant_id"])
    created = await _create_device(client, headers, "Sensor 1")

    resp = await client.post(
        "/ingest",
        json={"metric": metric, "value": 1},
        headers=_basic_auth_header(
            created["credential"]["username"], created["credential"]["password"]
        ),
    )

    assert resp.status_code == 422


def test_http_ingest_is_rate_limited_per_device_per_minute() -> None:
    device = uuid.uuid4()
    other = uuid.uuid4()
    t0 = 1_800_000_000.0
    allowed = [allow_http_reading(device, t0 + i * 0.1) for i in range(HTTP_INGEST_PER_MINUTE + 5)]
    assert allowed.count(True) == HTTP_INGEST_PER_MINUTE
    assert allow_http_reading(other, t0)  # per device
    assert allow_http_reading(device, t0 + 60)  # next minute


@pytest.mark.parametrize(
    ("suffix", "action", "result"),
    [
        ("temperature", "publish", "allow"),
        ("status", "publish", "allow"),
        ("ack/fan1", "publish", "allow"),
        # What the platform sends a device: never published by the device.
        ("cmd/fan1", "publish", "deny"),
        ("state/fan1", "publish", "deny"),
        ("config", "publish", "deny"),
        ("ota", "publish", "deny"),
        ("a/b/c", "publish", "deny"),
        # Reading its own subtree is fine.
        ("cmd/fan1", "subscribe", "allow"),
        ("state/fan1", "subscribe", "allow"),
        ("config", "subscribe", "allow"),
        ("ota", "subscribe", "allow"),
    ],
)
async def test_emqx_authorize_device_by_direction(
    client: httpx.AsyncClient,
    admin_session: AsyncSession,
    suffix: str,
    action: str,
    result: str,
) -> None:
    owner = await _register(client, f"dir-{abs(hash((suffix, action)))}@example.com", "Dir")
    tenant_id = owner["memberships"][0]["tenant_id"]
    created = await _create_device(client, _auth_headers(owner, tenant_id), "Sensor 1")
    slug = await _tenant_slug(admin_session, tenant_id)

    resp = await client.post(
        "/ingestion/emqx/authorize",
        json={
            "username": created["credential"]["username"],
            "topic": f"{slug}/{created['device']['slug']}/{suffix}",
            "action": action,
        },
        headers=EMQX_HEADERS,
    )

    assert resp.json()["result"] == result


async def test_sign_in_is_throttled_after_repeated_failures(
    client: httpx.AsyncClient, redis_kv: dict[str, str]
) -> None:
    await _register(client, "throttle@example.com", "Throttle")
    for _ in range(10):
        bad = await client.post(
            "/auth/login", json={"email": "throttle@example.com", "password": "wrong-password"}
        )
        assert bad.status_code == 401

    blocked = await client.post(
        "/auth/login", json={"email": "throttle@example.com", "password": "hunter2hunter2"}
    )
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"] == "900"

    # A different account from the same place isn't blocked yet.
    await _register(client, "other@example.com", "Other")
    ok = await client.post(
        "/auth/login", json={"email": "other@example.com", "password": "hunter2hunter2"}
    )
    assert ok.status_code == 200
