"""Rules run on the server's clock, whatever the device's timestamp says; the
stored reading keeps the device's time (worker.handle_message)."""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app import worker
from app.devices.models import DeviceStatus
from app.devices.service import DeviceDirectoryRecord


async def test_rules_get_server_time_and_storage_gets_device_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    device = DeviceDirectoryRecord(
        tenant_id=uuid.uuid4(), device_id=uuid.uuid4(), status=DeviceStatus.ACTIVE.value
    )
    monkeypatch.setattr(
        worker.ingestion_service, "resolve_device_for_topic", AsyncMock(return_value=device)
    )
    evaluate = AsyncMock()
    monkeypatch.setattr(worker.rules_service, "evaluate_and_dispatch", evaluate)
    store = AsyncMock()
    monkeypatch.setattr(worker.ingestion_service, "record_telemetry_direct", store)
    device_time = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp())  # a lagging device clock

    before = datetime.now(UTC)
    await worker.handle_message(
        AsyncMock(),
        AsyncMock(),
        AsyncMock(),
        "acme/bay1/temperature",
        f'{{"value": 30, "timestamp": {device_time}}}'.encode(),
    )

    rule_time = evaluate.await_args.args[-1]
    assert before <= rule_time <= datetime.now(UTC)
    stored_time = store.await_args.args[-1]
    assert stored_time == datetime.fromtimestamp(device_time, tz=UTC)
