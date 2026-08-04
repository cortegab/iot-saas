"""Unit tests for app.rules.evaluators — pure, no DB. Exhaustive per
CLAUDE.md's explicit mandate: this is the highest-consequence logic in the
codebase, and a flapping bug cycles a physical relay and destroys hardware.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.rules.evaluators import Reading, RuleState, ThresholdEvaluator
from app.rules.models import Rule

_EVALUATOR = ThresholdEvaluator()
_BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)


def _rule(
    operator: str,
    threshold: float,
    for_duration: int = 0,
    hysteresis: float = 0.0,
    cooldown: int = 0,
) -> Rule:
    return Rule(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        device_id=uuid.uuid4(),
        metric="temperature",
        type="threshold",
        operator=operator,
        threshold=threshold,
        for_duration=for_duration,
        hysteresis=hysteresis,
        cooldown=cooldown,
        action={"type": "actuator_command", "actuator": "fan1", "value": True},
        enabled=True,
    )


def _reading(value: float, offset_seconds: float = 0) -> Reading:
    return Reading(
        device_id=uuid.uuid4(),
        metric="temperature",
        value=value,
        timestamp=_BASE_TIME + timedelta(seconds=offset_seconds),
    )


# ---- Boundary values at exactly the threshold, per operator ----------------


@pytest.mark.parametrize(
    "operator,fires_at_threshold",
    [(">", False), (">=", True), ("<", False), ("<=", True), ("==", True), ("!=", False)],
)
def test_boundary_at_exact_threshold(operator: str, fires_at_threshold: bool) -> None:
    rule = _rule(operator, threshold=30.0)
    state = RuleState()
    action = _EVALUATOR.evaluate(rule, _reading(30.0), state)
    assert (action is not None) == fires_at_threshold


@pytest.mark.parametrize(
    "operator,value,should_fire",
    [
        (">", 30.1, True),
        (">", 29.9, False),
        (">=", 30.1, True),
        (">=", 29.9, False),
        ("<", 29.9, True),
        ("<", 30.1, False),
        ("<=", 29.9, True),
        ("<=", 30.1, False),
        ("==", 30.0, True),
        ("==", 30.1, False),
        ("!=", 30.1, True),
        ("!=", 30.0, False),
    ],
)
def test_boundary_around_threshold(operator: str, value: float, should_fire: bool) -> None:
    rule = _rule(operator, threshold=30.0)
    state = RuleState()
    action = _EVALUATOR.evaluate(rule, _reading(value), state)
    assert (action is not None) == should_fire


# ---- for_duration ------------------------------------------------------------


def test_for_duration_not_held_long_enough_does_not_fire() -> None:
    rule = _rule(">", threshold=30.0, for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is None
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 5), state) is None


def test_for_duration_held_exactly_fires() -> None:
    rule = _rule(">", threshold=30.0, for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is None
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 10), state)
    assert action is not None


def test_for_duration_condition_dropping_resets_the_timer() -> None:
    rule = _rule(">", threshold=30.0, for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is None
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 8), state) is None  # 8s held, not yet
    assert _EVALUATOR.evaluate(rule, _reading(25.0, 9), state) is None  # condition drops
    assert state.condition_since is None
    # Condition true again — the timer must restart, not resume from 8s.
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 9.5), state) is None
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 19.4), state) is None  # 9.9s held, just short
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 19.5), state)  # 10s held from restart
    assert action is not None


# ---- hysteresis re-arm --------------------------------------------------------


def test_hysteresis_rearm_gt() -> None:
    rule = _rule(">", threshold=30.0, hysteresis=5.0)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is not None
    # Still above the bare threshold but hasn't crossed the rearm point (30-5=25).
    assert _EVALUATOR.evaluate(rule, _reading(26.0, 1), state) is None
    assert state.armed is False
    # Crosses the rearm point; condition is also false here, so it re-arms without firing.
    assert _EVALUATOR.evaluate(rule, _reading(24.0, 2), state) is None
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 3), state)
    assert action is not None


def test_hysteresis_rearm_lt() -> None:
    rule = _rule("<", threshold=30.0, hysteresis=5.0)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(25.0, 0), state) is not None
    # Still below the bare threshold but hasn't crossed the rearm point (30+5=35).
    assert _EVALUATOR.evaluate(rule, _reading(34.0, 1), state) is None
    assert state.armed is False
    assert _EVALUATOR.evaluate(rule, _reading(36.0, 2), state) is None
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, _reading(25.0, 3), state)
    assert action is not None


@pytest.mark.parametrize("operator", [">=", "<="])
def test_hysteresis_rearm_inclusive_operators(operator: str) -> None:
    fire_value = 35.0 if operator == ">=" else 25.0
    rule = _rule(operator, threshold=30.0, hysteresis=5.0)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(fire_value, 0), state) is not None
    assert state.armed is False


def test_hysteresis_ignored_for_equality_operators() -> None:
    rule = _rule("==", threshold=30.0, hysteresis=5.0)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(30.0, 0), state) is not None
    assert state.armed is False
    # Condition false (30.1 != 30.0) — re-arms immediately; hysteresis has no
    # meaning for equality operators.
    assert _EVALUATOR.evaluate(rule, _reading(30.1, 1), state) is None
    assert state.armed is True


# ---- cooldown ------------------------------------------------------------------


def test_cooldown_suppresses_refire_even_after_rearm() -> None:
    rule = _rule(">", threshold=30.0, hysteresis=5.0, cooldown=60)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is not None
    assert _EVALUATOR.evaluate(rule, _reading(20.0, 1), state) is None  # drops, re-arms
    assert state.armed is True
    # Re-armed, but only 10s since last fire — cooldown (60s) hasn't elapsed.
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 10), state) is None
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 61), state)
    assert action is not None


def test_cooldown_exactly_met_fires() -> None:
    rule = _rule(">", threshold=30.0, cooldown=60)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 0), state) is not None
    assert _EVALUATOR.evaluate(rule, _reading(20.0, 1), state) is None  # rearm (no hysteresis)
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 60), state)  # exactly 60s since t=0
    assert action is not None


# ---- flapping prevention: the actual point of all this ------------------------


def test_rapid_oscillation_around_bare_threshold_does_not_refire() -> None:
    """The core anti-flapping guarantee: oscillating right at the threshold,
    without crossing the hysteresis margin, must not cause repeated firing.
    """
    rule = _rule(">", threshold=30.0, hysteresis=2.0)
    state = RuleState()
    fire_count = 0
    values = [30.5, 29.5, 30.5, 29.5, 30.5, 29.5, 30.5, 29.5]
    for i, value in enumerate(values):
        action = _EVALUATOR.evaluate(rule, _reading(value, i), state)
        if action is not None:
            fire_count += 1
    assert fire_count == 1


def test_full_lifecycle_breach_hold_fire_oscillate_cooldown_rearm_refire() -> None:
    rule = _rule(">", threshold=30.0, for_duration=5, hysteresis=2.0, cooldown=30)
    state = RuleState()

    assert _EVALUATOR.evaluate(rule, _reading(25.0, 0), state) is None  # below threshold
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 1), state) is None  # breach, not held yet
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 4), state) is None
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 6), state) is not None  # held 5s -> fires

    # Oscillate around the bare threshold without reaching the rearm point (28) — no refire.
    for i, value in enumerate([30.5, 29.5, 30.5], start=7):
        assert _EVALUATOR.evaluate(rule, _reading(value, i), state) is None

    assert _EVALUATOR.evaluate(rule, _reading(27.0, 10), state) is None  # crosses rearm point
    assert state.armed is True

    # Condition true again and held long enough, but cooldown (30s since t=6) hasn't elapsed.
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 11), state) is None
    assert _EVALUATOR.evaluate(rule, _reading(35.0, 20), state) is None

    # Cooldown elapses at t=36; condition has held continuously since t=11.
    action = _EVALUATOR.evaluate(rule, _reading(35.0, 37), state)
    assert action is not None


# ---- Action payload -------------------------------------------------------------


def test_action_matches_rule() -> None:
    rule = _rule(">", threshold=30.0)
    state = RuleState()
    action = _EVALUATOR.evaluate(rule, _reading(35.0), state)
    assert action is not None
    assert action.rule_id == rule.id
    assert action.action_type == "actuator_command"
    assert action.payload == rule.action
