"""Pending stream entries left by a previous run are stored (worker.drain_pending),
and the telemetry stream is capped at XADD time. Pure, with a fake Redis."""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app import worker
from app.ingestion import service as ingestion_service
from app.ingestion.schemas import TelemetryPayload


def _entry(value: str) -> dict[str, str]:
    return {
        "tenant_id": str(uuid.uuid4()),
        "device_id": str(uuid.uuid4()),
        "metric": "temperature",
        "value": value,
        "timestamp": str(datetime.now(UTC).timestamp()),
    }


class _PendingRedis:
    """XREADGROUP from id "0" returns this consumer's pending entries until
    they are acknowledged, like Redis does."""

    def __init__(self, pending: list[tuple[str, dict[str, str] | None]]) -> None:
        self.pending = pending
        self.acked: list[str] = []

    async def xreadgroup(self, *_: Any, count: int, **__: Any) -> list[Any]:
        batch = self.pending[:count]
        return [("telemetry", batch)] if batch else []

    async def xack(self, _stream: str, _group: str, *ids: str) -> int:
        self.acked.extend(ids)
        self.pending = [e for e in self.pending if e[0] not in ids]
        return len(ids)


async def test_pending_entries_are_stored_and_acknowledged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    write = AsyncMock(side_effect=lambda _f, rows: len(rows))
    monkeypatch.setattr(worker, "write_telemetry_batch", write)
    # The middle entry was trimmed from the stream while still pending.
    r = _PendingRedis([("1-0", _entry("1")), ("2-0", None), ("3-0", _entry("3"))])

    stored = await worker.drain_pending(AsyncMock(), r, batch_size=2)  # type: ignore[arg-type]

    assert stored == 2
    assert r.acked == ["1-0", "2-0", "3-0"]
    assert r.pending == []


async def test_nothing_pending_writes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    write = AsyncMock()
    monkeypatch.setattr(worker, "write_telemetry_batch", write)

    assert await worker.drain_pending(AsyncMock(), _PendingRedis([]), batch_size=500) == 0  # type: ignore[arg-type]
    write.assert_not_awaited()


async def test_telemetry_stream_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingestion_service.realtime_service, "publish_event", AsyncMock())
    r = AsyncMock()

    await ingestion_service.record_telemetry_direct(
        r, uuid.uuid4(), uuid.uuid4(), "temperature", TelemetryPayload(value=1.0), datetime.now(UTC)
    )

    kwargs = r.xadd.await_args.kwargs
    assert kwargs["maxlen"] == ingestion_service.settings.telemetry_stream_maxlen
    assert kwargs["approximate"] is True
