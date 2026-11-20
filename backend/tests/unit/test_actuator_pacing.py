"""Minimum interval per actuator (commands.service.dispatch_command): inside
the interval the latest value waits and is sent when it ends, or not at all if
it settled back to the value already sent. Short intervals keep this fast."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.commands import service as commands_service
from app.config import settings

INTERVAL = 0.05
DEVICE = uuid.uuid4()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any]]:
    monkeypatch.setattr(settings, "actuator_min_interval_seconds", INTERVAL)
    published: list[tuple[str, Any]] = []

    async def publish(*args: Any, command_id: uuid.UUID | None = None) -> uuid.UUID:
        published.append((args[8], args[9]))  # actuator, value
        return command_id or uuid.uuid4()

    monkeypatch.setattr(commands_service, "_publish_command", publish)
    return published


async def _send(actuator: str, value: Any) -> uuid.UUID | None:
    return await commands_service.dispatch_command(
        AsyncMock(),
        AsyncMock(),
        uuid.uuid4(),
        DEVICE,
        None,
        datetime.now(UTC),
        "acme",
        "bay1",
        actuator,
        value,
    )


async def test_first_command_goes_out_at_once(sent: list[tuple[str, Any]]) -> None:
    assert await _send("fan", True) is not None
    assert sent == [("fan", True)]


async def test_a_change_inside_the_interval_waits_then_goes_out(
    sent: list[tuple[str, Any]],
) -> None:
    await _send("fan", True)
    assert await _send("fan", False) is None
    assert sent == [("fan", True)]

    await asyncio.sleep(INTERVAL * 3)

    assert sent == [("fan", True), ("fan", False)]


async def test_only_the_latest_waiting_value_is_sent(sent: list[tuple[str, Any]]) -> None:
    await _send("dimmer", 10)
    await _send("dimmer", 20)
    await _send("dimmer", 30)

    await asyncio.sleep(INTERVAL * 3)

    assert sent == [("dimmer", 10), ("dimmer", 30)]


async def test_a_bounce_that_settles_back_sends_nothing_more(
    sent: list[tuple[str, Any]],
) -> None:
    await _send("relay", True)
    await _send("relay", False)
    await _send("relay", True)

    await asyncio.sleep(INTERVAL * 3)

    assert sent == [("relay", True)]


async def test_actuators_are_paced_independently(sent: list[tuple[str, Any]]) -> None:
    await _send("relay", True)
    await _send("relay_2", True)
    await _send("relay_3", True)

    assert sent == [("relay", True), ("relay_2", True), ("relay_3", True)]


async def test_zero_turns_pacing_off(
    sent: list[tuple[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "actuator_min_interval_seconds", 0.0)
    await _send("fan", True)
    await _send("fan", False)
    assert sent == [("fan", True), ("fan", False)]


async def test_invalid_actuator_is_refused(sent: list[tuple[str, Any]]) -> None:
    with pytest.raises(commands_service.InvalidActuatorError):
        await _send("fan/1", True)
    assert sent == []
