"""Unit tests for app.rules.service._simulate_replay — walks a synthetic
telemetry series through the real ThresholdEvaluator. telemetry_service
.get_range is monkeypatched so there's no DB.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.rules import service as rules_service
from app.rules.models import Rule
from app.rules.schemas import RuleHealth, RuleSignalHealth, SimulateReplayWindow
from app.telemetry.schemas import TelemetryDataPoint, TelemetryDataResponse

_DEVICE = uuid.uuid4()
_START = datetime(2026, 6, 1, tzinfo=UTC)


def _rule(*, for_duration: int = 0, cooldown: int = 0) -> Rule:
    return Rule(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="replay rule",
        type="threshold",
        trigger={"type": "metric"},
        condition={
            "kind": "leaf",
            "device_id": str(_DEVICE),
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": 30.0},
            "hysteresis": 0.0,
        },
        execution_policy={"strategy": "edge", "for_duration": for_duration, "cooldown": cooldown},
        actions=[{"type": "actuator_command", "actuator": "fan1", "value": True}],
        enabled=True,
    )


def _health() -> RuleHealth:
    return RuleHealth(
        evaluatable=True,
        signals=[
            RuleSignalHealth(
                device_id=_DEVICE,
                device_name="Sensor",
                metric="temperature",
                state="fresh",
                last_value=None,
                last_seen_at=None,
                max_age_seconds=90,
            )
        ],
    )


def _series(monkeypatch: pytest.MonkeyPatch, points: list[tuple[int, float]]) -> None:
    async def fake_get_range(
        session: Any,
        tenant_id: Any,
        device_id: Any,
        metric: str,
        from_: Any,
        to: Any,
        resolution: str,
    ) -> TelemetryDataResponse:
        return TelemetryDataResponse(
            metric=metric,
            resolution=resolution,
            points=[
                TelemetryDataPoint(time=_START + timedelta(seconds=s), value=v) for s, v in points
            ],
        )

    monkeypatch.setattr(rules_service.telemetry_service, "get_range", fake_get_range)


async def test_replay_reports_each_edge_crossing(monkeypatch: pytest.MonkeyPatch) -> None:
    _series(monkeypatch, [(0, 20.0), (10, 35.0), (20, 20.0), (30, 40.0)])
    result = await rules_service._simulate_replay(
        None,  # type: ignore[arg-type]
        _rule(),
        SimulateReplayWindow.model_validate({"from": _START, "to": _START + timedelta(hours=1)}),
        _health(),
    )
    assert result.resolution == "raw"
    assert result.samples == 4
    # fires at the 35.0 sample, re-arms at 20.0, fires again at 40.0
    assert [p - _START for p in result.would_have_fired_at] == [
        timedelta(seconds=10),
        timedelta(seconds=30),
    ]


async def test_replay_honours_for_duration(monkeypatch: pytest.MonkeyPatch) -> None:
    _series(monkeypatch, [(0, 35.0), (30, 35.0), (120, 35.0)])
    result = await rules_service._simulate_replay(
        None,  # type: ignore[arg-type]
        _rule(for_duration=60),
        SimulateReplayWindow.model_validate({"from": _START, "to": _START + timedelta(hours=1)}),
        _health(),
    )
    # held above threshold since t=0; only the t=120 sample clears the 60s hold
    assert [p - _START for p in result.would_have_fired_at] == [timedelta(seconds=120)]


async def test_replay_rejects_backwards_window(monkeypatch: pytest.MonkeyPatch) -> None:
    _series(monkeypatch, [])
    with pytest.raises(rules_service.RuleValidationError):
        await rules_service._simulate_replay(
            None,  # type: ignore[arg-type]
            _rule(),
            SimulateReplayWindow.model_validate(
                {"from": _START + timedelta(hours=1), "to": _START}
            ),
            _health(),
        )


async def test_replay_rejects_window_over_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    _series(monkeypatch, [])
    with pytest.raises(rules_service.RuleValidationError):
        await rules_service._simulate_replay(
            None,  # type: ignore[arg-type]
            _rule(),
            SimulateReplayWindow.model_validate(
                {"from": _START, "to": _START + timedelta(days=365)}
            ),
            _health(),
        )


async def test_replay_switches_to_1m_resolution_past_6h(monkeypatch: pytest.MonkeyPatch) -> None:
    _series(monkeypatch, [(0, 10.0)])
    result = await rules_service._simulate_replay(
        None,  # type: ignore[arg-type]
        _rule(),
        SimulateReplayWindow.model_validate({"from": _START, "to": _START + timedelta(hours=12)}),
        _health(),
    )
    assert result.resolution == "1m"


async def test_replay_truncates_at_the_sample_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules_service.settings, "simulate_replay_max_samples", 3)
    _series(monkeypatch, [(i, 10.0) for i in range(10)])
    result = await rules_service._simulate_replay(
        None,  # type: ignore[arg-type]
        _rule(),
        SimulateReplayWindow.model_validate({"from": _START, "to": _START + timedelta(hours=1)}),
        _health(),
    )
    assert result.truncated is True
    assert result.samples == 3
