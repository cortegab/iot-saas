"""GET /health/ready against the real app and test database, with Redis
stubbed (conftest's redis_kv holds the heartbeat key)."""

import json
import time
from unittest.mock import AsyncMock

import httpx
import pytest

from app.readiness.service import HEARTBEAT_KEY


@pytest.fixture(autouse=True)
def _redis_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.redis.redis_client.ping", AsyncMock(return_value=True))
    monkeypatch.setattr("app.redis.redis_client.xinfo_groups", AsyncMock(return_value=[]))


async def test_ready_when_everything_works(
    client: httpx.AsyncClient, redis_kv: dict[str, str]
) -> None:
    redis_kv[HEARTBEAT_KEY] = json.dumps({"ts": time.time(), "mqtt_connected": True})

    resp = await client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert set(body["checks"]) == {"database", "redis", "worker", "telemetry_storage"}


async def test_not_ready_without_a_worker_heartbeat(client: httpx.AsyncClient) -> None:
    resp = await client.get("/health/ready")

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "failing"
    assert body["checks"]["worker"]["ok"] is False
