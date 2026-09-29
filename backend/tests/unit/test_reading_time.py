"""Unit tests for the single per-reading timestamp: ingestion.service.reading_time
and the stream writer's parse of it (worker._row_from_stream_entry) — pure, no DB.
The stored row and the live WS frame must carry the same sub-second time, or the
frontend drops live frames as "older" than what REST returned.
"""

import uuid
from datetime import UTC, datetime

from app.ingestion.schemas import TelemetryPayload
from app.ingestion.service import reading_time
from app.worker import _row_from_stream_entry


def _fields(timestamp: str) -> dict[str, str]:
    return {
        "tenant_id": str(uuid.uuid4()),
        "device_id": str(uuid.uuid4()),
        "metric": "temperature",
        "value": "27.4",
        "timestamp": timestamp,
    }


def test_reading_time_uses_device_timestamp() -> None:
    payload = TelemetryPayload(value=1.0, timestamp=1770001111)
    assert reading_time(payload) == datetime.fromtimestamp(1770001111, tz=UTC)


def test_reading_time_falls_back_to_subsecond_now() -> None:
    before = datetime.now(UTC)
    stamped = reading_time(TelemetryPayload(value=1.0))
    assert before <= stamped <= datetime.now(UTC)


def test_stream_row_keeps_subsecond_receive_time() -> None:
    received = datetime(2026, 9, 28, 10, 0, 6, 412000, tzinfo=UTC)
    row = _row_from_stream_entry(_fields(str(received.timestamp())))
    assert row is not None
    assert row[0] == received


def test_stream_row_accepts_legacy_int_timestamp() -> None:
    row = _row_from_stream_entry(_fields("1770001111"))
    assert row is not None
    assert row[0] == datetime.fromtimestamp(1770001111, tz=UTC)


def test_stream_row_empty_timestamp_stamps_now() -> None:
    before = datetime.now(UTC)
    row = _row_from_stream_entry(_fields(""))
    assert row is not None
    assert before <= row[0] <= datetime.now(UTC)


def test_stream_row_garbage_timestamp_dropped() -> None:
    assert _row_from_stream_entry(_fields("not-a-number")) is None
