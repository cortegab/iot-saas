"""Shared by unit and integration tests."""

from collections.abc import Iterator

import pytest

from app.commands import service as commands_service
from app.config import settings


@pytest.fixture(autouse=True)
def _no_actuator_pacing(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Most tests fire the same actuator several times in a row and check each
    command; the per-actuator minimum interval is tested on its own
    (test_actuator_pacing.py), which turns it back on."""
    monkeypatch.setattr(settings, "actuator_min_interval_seconds", 0.0)
    commands_service.reset_pacing()
    yield
    commands_service.reset_pacing()
