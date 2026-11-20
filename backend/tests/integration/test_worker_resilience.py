"""The worker keeps going when one message, one row or one loop goes wrong
(CLAUDE.md constraint 11): a batch with a deleted device's row stores the
rest, retained telemetry is dropped, and a failing loop restarts alone."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import worker


async def _workspace_with_device(client: httpx.AsyncClient) -> tuple[str, str]:
    resp = await client.post(
        "/auth/register",
        json={"email": "w@example.com", "password": "hunter2hunter2", "tenant_name": "W"},
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    tenant_id = body["memberships"][0]["tenant_id"]
    headers = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}
    entry_id = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    resp = await client.post(
        "/devices", json={"name": "Bay 1", "catalog_entry_id": entry_id}, headers=headers
    )
    assert resp.status_code == 201
    return tenant_id, resp.json()["device"]["id"]


async def _count(admin_session: AsyncSession) -> int:
    result = await admin_session.execute(text("SELECT count(*) FROM telemetry"))
    return int(result.scalar_one())


async def test_batch_with_a_deleted_device_stores_the_other_rows(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    tenant_id, device_id = await _workspace_with_device(client)
    now = datetime.now(UTC)
    tid, did = uuid.UUID(tenant_id), uuid.UUID(device_id)
    rows: list[worker._TelemetryRow] = [
        (now, tid, did, "temperature", 21.0),
        (now, tid, uuid.uuid4(), "temperature", 22.0),  # device deleted meanwhile
        (now, tid, did, "humidity", 55.0),
    ]

    stored = await worker.write_telemetry_batch(app_session_factory, rows)

    assert stored == 2
    assert await _count(admin_session) == 2


async def test_batch_with_only_bad_rows_stores_nothing(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    tenant_id, _ = await _workspace_with_device(client)
    rows: list[worker._TelemetryRow] = [
        (datetime.now(UTC), uuid.UUID(tenant_id), uuid.uuid4(), "temperature", 1.0)
    ]

    assert await worker.write_telemetry_batch(app_session_factory, rows) == 0
    assert await _count(admin_session) == 0


async def test_retained_telemetry_is_dropped_before_the_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluate = AsyncMock()
    monkeypatch.setattr(worker.rules_service, "evaluate_and_dispatch", evaluate)
    resolve = AsyncMock()
    monkeypatch.setattr(worker.ingestion_service, "resolve_device_for_topic", resolve)

    await worker.handle_message(
        AsyncMock(),
        AsyncMock(),
        AsyncMock(),
        "demo/bay1/temperature",
        b'{"value": 1, "timestamp": 99999999999999}',
        retain=True,
    )

    evaluate.assert_not_awaited()
    resolve.assert_not_awaited()


async def test_a_failing_loop_restarts_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    async def flaky() -> None:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError("redis went away")
        raise asyncio.CancelledError  # shutdown: must propagate

    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(worker.asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await worker.supervise("flaky", flaky)

    assert calls == 3
    assert sleeps == [1.0, 2.0]
