"""Unit tests for the Phase 5 pure helpers in app.rules.evaluators — the
annotated `explain_condition` walk (backs POST /rules/{id}/simulate) and the
RuleState <-> dict round-trip (backs the Redis checkpoint). No DB.

(Named ..._eval_helpers, not ..._rule_health, so pytest's rootless module
naming doesn't collide with tests/integration/test_rule_health.py.)
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.rules.evaluators import (
    LeafState,
    MetricSnapshot,
    MetricValue,
    RuleState,
    SignalKey,
    evaluate_condition,
    explain_condition,
    rule_state_from_dict,
    rule_state_to_dict,
)

_NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
_DEVICE = str(uuid.uuid4())


def _leaf(metric: str, operator: str, threshold: float) -> dict[str, Any]:
    return {
        "kind": "leaf",
        "device_id": _DEVICE,
        "metric": metric,
        "operator": operator,
        "rhs": {"source": "static", "value": threshold},
        "hysteresis": 0.0,
    }


def _snapshot(**metrics: float) -> MetricSnapshot:
    return {
        SignalKey(_DEVICE, metric): MetricValue(value=value, timestamp=_NOW, max_age_seconds=90)
        for metric, value in metrics.items()
    }


def test_explain_leaf_true() -> None:
    tree = explain_condition(_leaf("temperature", ">", 30.0), _snapshot(temperature=35.0), _NOW)
    assert tree["kind"] == "leaf"
    assert tree["result"] is True
    assert tree["signal_state"] == "fresh"
    assert tree["observed_value"] == 35.0


def test_explain_leaf_false() -> None:
    tree = explain_condition(_leaf("temperature", ">", 30.0), _snapshot(temperature=20.0), _NOW)
    assert tree["result"] is False
    assert tree["signal_state"] == "fresh"


def test_explain_leaf_missing_signal() -> None:
    tree = explain_condition(_leaf("temperature", ">", 30.0), {}, _NOW)
    assert tree["result"] is False
    assert tree["signal_state"] == "missing"
    assert tree["observed_value"] is None


def test_explain_leaf_stale_signal() -> None:
    snapshot = {
        SignalKey(_DEVICE, "temperature"): MetricValue(
            value=99.0, timestamp=_NOW - timedelta(seconds=200), max_age_seconds=90
        )
    }
    tree = explain_condition(_leaf("temperature", ">", 30.0), snapshot, _NOW)
    assert tree["result"] is False
    assert tree["signal_state"] == "stale"
    assert tree["observed_value"] == 99.0  # still surfaced for the UI


def test_explain_group_and_or() -> None:
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [_leaf("temperature", ">", 30.0), _leaf("humidity", "<", 40.0)],
    }
    both = explain_condition(condition, _snapshot(temperature=35.0, humidity=20.0), _NOW)
    assert both["result"] is True
    assert [p["result"] for p in both["predicates"]] == [True, True]

    one = explain_condition(condition, _snapshot(temperature=35.0, humidity=60.0), _NOW)
    assert one["result"] is False

    condition_or = {**condition, "op": "OR"}
    or_one = explain_condition(condition_or, _snapshot(temperature=10.0, humidity=20.0), _NOW)
    assert or_one["result"] is True  # humidity leaf alone satisfies OR


def test_explain_matches_evaluate_condition() -> None:
    """explain_condition must agree with evaluate_condition for the same
    inputs — same walk, one just carries annotations."""
    condition = {
        "kind": "group",
        "op": "OR",
        "predicates": [
            _leaf("temperature", ">", 30.0),
            {
                "kind": "group",
                "op": "AND",
                "predicates": [_leaf("humidity", ">", 50.0), _leaf("pressure", "<", 10.0)],
            },
        ],
    }
    for snap in (
        _snapshot(temperature=35.0, humidity=10.0, pressure=20.0),
        _snapshot(temperature=10.0, humidity=60.0, pressure=5.0),
        _snapshot(temperature=10.0, humidity=60.0, pressure=20.0),
    ):
        assert explain_condition(condition, snap, _NOW)["result"] == evaluate_condition(
            condition, snap, _NOW
        )


def test_rule_state_round_trip() -> None:
    state = RuleState(
        condition_since=_NOW - timedelta(seconds=30),
        armed=False,
        last_fired_at=_NOW - timedelta(minutes=5),
        leaf_states={
            (): LeafState(latched_true=True),
            (0, 1): LeafState(latched_true=False),
            (1, 0, 2): LeafState(latched_true=True),
        },
    )
    restored = rule_state_from_dict(rule_state_to_dict(state))
    assert restored.condition_since == state.condition_since
    assert restored.armed is False
    assert restored.last_fired_at == state.last_fired_at
    assert restored.leaf_states[()].latched_true is True
    assert restored.leaf_states[(0, 1)].latched_true is False
    assert restored.leaf_states[(1, 0, 2)].latched_true is True


def test_rule_state_from_garbage_is_fresh() -> None:
    for junk in (None, "nope", 42, {"condition_since": "not-a-date", "armed": "yes"}):
        state = rule_state_from_dict(junk)
        assert isinstance(state, RuleState)
    # a bad datetime string degrades to None, not a crash
    assert rule_state_from_dict({"armed": True, "condition_since": "xyz"}).condition_since is None
