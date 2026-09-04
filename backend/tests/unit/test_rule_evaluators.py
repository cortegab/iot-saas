"""Unit tests for app.rules.evaluators — pure, no DB. Exhaustive per
CLAUDE.md's explicit mandate: this is the highest-consequence logic in the
codebase, and a flapping bug cycles a physical relay and destroys hardware.

The single-leaf tests below are close to line-for-line ports of the original
single-metric evaluator's test suite — the new tree evaluator is designed to
be a faithful generalization (per-leaf hysteresis stabilizes each predicate's
own boolean; rule-level for_duration/cooldown/armed then gate the combined
result exactly as before), so a single-leaf condition must behave identically
to the old flat rule. That parity is itself the regression test.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.rules.evaluators import (
    Firing,
    MetricSnapshot,
    MetricValue,
    RuleState,
    SignalKey,
    ThresholdEvaluator,
)
from app.rules.models import Rule

_EVALUATOR = ThresholdEvaluator()
_BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)
_DEVICE_A = str(uuid.uuid4())
_DEVICE_B = str(uuid.uuid4())


def _leaf(
    operator: str,
    threshold: float,
    hysteresis: float = 0.0,
    metric: str = "temperature",
    device_id: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": "leaf",
        "device_id": device_id or _DEVICE_A,
        "metric": metric,
        "operator": operator,
        "threshold": threshold,
        "hysteresis": hysteresis,
    }


def _rule(
    condition: dict[str, Any],
    for_duration: int = 0,
    cooldown: int = 0,
    strategy: str = "edge",
    reset_condition: dict[str, Any] | None = None,
    actions: list[dict[str, Any]] | None = None,
) -> Rule:
    return Rule(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="test rule",
        type="threshold",
        trigger={"type": "metric"},
        condition=condition,
        execution_policy={
            "strategy": strategy,
            "for_duration": for_duration,
            "cooldown": cooldown,
            "reset_condition": reset_condition,
        },
        actions=actions or [{"type": "actuator_command", "actuator": "fan1", "value": True}],
        enabled=True,
    )


def _at(
    value: float, offset_seconds: float = 0, metric: str = "temperature", device_id: str | None = None
) -> tuple[MetricSnapshot, datetime]:
    """A single-signal snapshot plus the timestamp to evaluate "now" as."""
    now = _BASE_TIME + timedelta(seconds=offset_seconds)
    return {SignalKey(device_id or _DEVICE_A, metric): MetricValue(value=value, timestamp=now)}, now


def _multi_at(
    values: dict[str, tuple[float, float]], device_id: str | None = None
) -> tuple[MetricSnapshot, datetime]:
    """Multiple metrics on one device, each with its own value/offset, all
    evaluated at the latest of their offsets.
    """
    did = device_id or _DEVICE_A
    snapshot = {
        SignalKey(did, metric): MetricValue(
            value=value, timestamp=_BASE_TIME + timedelta(seconds=offset)
        )
        for metric, (value, offset) in values.items()
    }
    now = _BASE_TIME + timedelta(seconds=max(offset for _, offset in values.values()))
    return snapshot, now


# ---- Boundary values at exactly the threshold, per operator (single leaf) --


@pytest.mark.parametrize(
    "operator,fires_at_threshold",
    [(">", False), (">=", True), ("<", False), ("<=", True), ("==", True), ("!=", False)],
)
def test_boundary_at_exact_threshold(operator: str, fires_at_threshold: bool) -> None:
    rule = _rule(_leaf(operator, 30.0))
    state = RuleState()
    snapshot, now = _at(30.0)
    action = _EVALUATOR.evaluate(rule, snapshot, now, state)
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
    rule = _rule(_leaf(operator, 30.0))
    state = RuleState()
    snapshot, now = _at(value)
    action = _EVALUATOR.evaluate(rule, snapshot, now, state)
    assert (action is not None) == should_fire


# ---- for_duration (single leaf) ---------------------------------------------


def test_for_duration_not_held_long_enough_does_not_fire() -> None:
    rule = _rule(_leaf(">", 30.0), for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 5), state) is None


def test_for_duration_held_exactly_fires() -> None:
    rule = _rule(_leaf(">", 30.0), for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is None
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 10), state)
    assert action is not None


def test_for_duration_condition_dropping_resets_the_timer() -> None:
    rule = _rule(_leaf(">", 30.0), for_duration=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 8), state) is None  # 8s held, not yet
    assert _EVALUATOR.evaluate(rule, *_at(25.0, 9), state) is None  # condition drops
    assert state.condition_since is None
    # Condition true again — the timer must restart, not resume from 8s.
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 9.5), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 19.4), state) is None  # 9.9s held, just short
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 19.5), state)  # 10s held from restart
    assert action is not None


# ---- hysteresis re-arm (single leaf — now implemented at the leaf) ----------


def test_hysteresis_rearm_gt() -> None:
    rule = _rule(_leaf(">", 30.0, hysteresis=5.0))
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is not None
    # Still above the bare threshold but hasn't crossed the rearm point (30-5=25).
    assert _EVALUATOR.evaluate(rule, *_at(26.0, 1), state) is None
    assert state.armed is False
    # Crosses the rearm point; condition is also false here, so it re-arms without firing.
    assert _EVALUATOR.evaluate(rule, *_at(24.0, 2), state) is None
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 3), state)
    assert action is not None


def test_hysteresis_rearm_lt() -> None:
    rule = _rule(_leaf("<", 30.0, hysteresis=5.0))
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(25.0, 0), state) is not None
    # Still below the bare threshold but hasn't crossed the rearm point (30+5=35).
    assert _EVALUATOR.evaluate(rule, *_at(34.0, 1), state) is None
    assert state.armed is False
    assert _EVALUATOR.evaluate(rule, *_at(36.0, 2), state) is None
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, *_at(25.0, 3), state)
    assert action is not None


@pytest.mark.parametrize("operator", [">=", "<="])
def test_hysteresis_rearm_inclusive_operators(operator: str) -> None:
    fire_value = 35.0 if operator == ">=" else 25.0
    rule = _rule(_leaf(operator, 30.0, hysteresis=5.0))
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(fire_value, 0), state) is not None
    assert state.armed is False


@pytest.mark.parametrize("operator", [">=", "<="])
def test_hysteresis_no_spurious_rearm_at_exact_threshold_repeated(operator: str) -> None:
    """Regression: with hysteresis=0 (the schema default), an inclusive
    operator's re-arm boundary must not coincide with a value the raw
    condition still considers true. A repeated reading pinned exactly at the
    threshold must stay latched, not spuriously unlatch and wipe
    condition_since on every other call — which starved for_duration and
    meant the rule could never fire.
    """
    rule = _rule(_leaf(operator, 30.0, hysteresis=0.0), for_duration=2)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(30.0, 0), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(30.0, 1), state) is None
    assert state.condition_since == _BASE_TIME  # not reset by a spurious rearm
    action = _EVALUATOR.evaluate(rule, *_at(30.0, 2), state)
    assert action is not None


def test_complementary_on_off_rules_at_shared_boundary() -> None:
    """Regression for the exact user-reported scenario: an ON rule (`>` 30)
    and an OFF rule (`<=` 30) on the same metric, both hysteresis=0, fed
    readings that settle exactly at the boundary. The OFF rule must fire
    once its for_duration elapses, not be starved forever.
    """
    on_rule = _rule(_leaf(">", 30.0, hysteresis=0.0), for_duration=2)
    off_rule = _rule(_leaf("<=", 30.0, hysteresis=0.0), for_duration=2)
    on_state = RuleState()
    off_state = RuleState()

    # Temperature above threshold: ON fires after for_duration, OFF never does.
    assert _EVALUATOR.evaluate(on_rule, *_at(35.0, 0), on_state) is None
    assert _EVALUATOR.evaluate(off_rule, *_at(35.0, 0), off_state) is None
    assert _EVALUATOR.evaluate(off_rule, *_at(35.0, 2), off_state) is None
    action = _EVALUATOR.evaluate(on_rule, *_at(35.0, 2), on_state)
    assert action is not None

    # Temperature settles at exactly 30, repeatedly: OFF must fire after
    # for_duration; ON must not.
    assert _EVALUATOR.evaluate(off_rule, *_at(30.0, 3), off_state) is None
    assert _EVALUATOR.evaluate(on_rule, *_at(30.0, 3), on_state) is None
    assert _EVALUATOR.evaluate(off_rule, *_at(30.0, 4), off_state) is None
    assert _EVALUATOR.evaluate(on_rule, *_at(30.0, 4), on_state) is None
    action = _EVALUATOR.evaluate(off_rule, *_at(30.0, 5), off_state)
    assert action is not None
    assert _EVALUATOR.evaluate(on_rule, *_at(30.0, 5), on_state) is None


def test_hysteresis_ignored_for_equality_operators() -> None:
    rule = _rule(_leaf("==", 30.0, hysteresis=5.0))
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(30.0, 0), state) is not None
    assert state.armed is False
    # Condition false (30.1 != 30.0) — re-arms immediately; hysteresis has no
    # meaning for equality operators.
    assert _EVALUATOR.evaluate(rule, *_at(30.1, 1), state) is None
    assert state.armed is True


# ---- cooldown (single leaf) --------------------------------------------------


def test_cooldown_suppresses_refire_even_after_rearm() -> None:
    rule = _rule(_leaf(">", 30.0, hysteresis=5.0), cooldown=60)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is not None
    assert _EVALUATOR.evaluate(rule, *_at(20.0, 1), state) is None  # drops, re-arms
    assert state.armed is True
    # Re-armed, but only 10s since last fire — cooldown (60s) hasn't elapsed.
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 10), state) is None
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 61), state)
    assert action is not None


def test_cooldown_exactly_met_fires() -> None:
    rule = _rule(_leaf(">", 30.0), cooldown=60)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is not None
    assert _EVALUATOR.evaluate(rule, *_at(20.0, 1), state) is None  # rearm (no hysteresis)
    assert state.armed is True
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 60), state)  # exactly 60s since t=0
    assert action is not None


# ---- flapping prevention: the actual point of all this (single leaf) --------


def test_rapid_oscillation_around_bare_threshold_does_not_refire() -> None:
    """The core anti-flapping guarantee: oscillating right at the threshold,
    without crossing the hysteresis margin, must not cause repeated firing.
    """
    rule = _rule(_leaf(">", 30.0, hysteresis=2.0))
    state = RuleState()
    fire_count = 0
    values = [30.5, 29.5, 30.5, 29.5, 30.5, 29.5, 30.5, 29.5]
    for i, value in enumerate(values):
        action = _EVALUATOR.evaluate(rule, *_at(value, i), state)
        if action is not None:
            fire_count += 1
    assert fire_count == 1


def test_full_lifecycle_breach_hold_fire_oscillate_cooldown_rearm_refire() -> None:
    rule = _rule(_leaf(">", 30.0, hysteresis=2.0), for_duration=5, cooldown=30)
    state = RuleState()

    assert _EVALUATOR.evaluate(rule, *_at(25.0, 0), state) is None  # below threshold
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 1), state) is None  # breach, not held yet
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 4), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 6), state) is not None  # held 5s -> fires

    # Oscillate around the bare threshold without reaching the rearm point (28) — no refire.
    for i, value in enumerate([30.5, 29.5, 30.5], start=7):
        assert _EVALUATOR.evaluate(rule, *_at(value, i), state) is None

    assert _EVALUATOR.evaluate(rule, *_at(27.0, 10), state) is None  # crosses rearm point
    assert state.armed is True

    # Condition true again and held long enough, but cooldown (30s since t=6) hasn't elapsed.
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 11), state) is None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 20), state) is None

    # Cooldown elapses at t=36; condition has held continuously since t=11.
    action = _EVALUATOR.evaluate(rule, *_at(35.0, 37), state)
    assert action is not None


# ---- Firing result ----------------------------------------------------------


def test_firing_carries_rule_id() -> None:
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    firing = _EVALUATOR.evaluate(rule, *_at(35.0), state)
    assert isinstance(firing, Firing)
    assert firing.rule_id == rule.id


# ---- Multi-predicate AND/OR trees ----------------------------------------------


def test_and_fires_only_when_both_predicates_true() -> None:
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [_leaf(">", 30.0, metric="temperature"), _leaf("<", 40.0, metric="humidity")],
    }
    rule = _rule(condition)
    state = RuleState()

    # Only temperature satisfied.
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (35.0, 0), "humidity": (50.0, 0)}), state) is None
    # Both satisfied.
    action = _EVALUATOR.evaluate(
        rule, *_multi_at({"temperature": (35.0, 1), "humidity": (35.0, 1)}), state
    )
    assert action is not None


def test_or_fires_when_either_predicate_true() -> None:
    condition = {
        "kind": "group",
        "op": "OR",
        "predicates": [_leaf(">", 30.0, metric="temperature"), _leaf("<", 10.0, metric="humidity")],
    }
    rule = _rule(condition)
    state = RuleState()

    # Neither satisfied.
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (20.0, 0), "humidity": (50.0, 0)}), state) is None
    # Only humidity satisfied — still fires under OR.
    action = _EVALUATOR.evaluate(
        rule, *_multi_at({"temperature": (20.0, 1), "humidity": (5.0, 1)}), state
    )
    assert action is not None


def test_leaf_with_no_snapshot_entry_is_unmet() -> None:
    """A predicate referencing a metric this device has never reported (or
    that isn't in the snapshot yet) fails closed — never fires on missing
    data.
    """
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    action = _EVALUATOR.evaluate(rule, {}, _BASE_TIME, state)
    assert action is None


def test_leaf_with_stale_snapshot_entry_is_unmet() -> None:
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    stale_snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(value=35.0, timestamp=_BASE_TIME)
    }
    just_over_90s = _BASE_TIME + timedelta(seconds=91)
    action = _EVALUATOR.evaluate(rule, stale_snapshot, just_over_90s, state)
    assert action is None


def test_leaf_snapshot_entry_exactly_at_staleness_boundary_still_fresh() -> None:
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(value=35.0, timestamp=_BASE_TIME)
    }
    exactly_90s = _BASE_TIME + timedelta(seconds=90)
    action = _EVALUATOR.evaluate(rule, snapshot, exactly_90s, state)
    assert action is not None


# ---- Phase 2: per-signal max_age_seconds (replaces the old global constant) -


def test_custom_max_age_seconds_makes_a_signal_stale_earlier_than_the_default() -> None:
    """A signal with a tighter bound (e.g. a "streaming" catalog metric) must
    go stale before the 90s default would — the bound lives on the value
    itself (rules/service.py's per-signal cache), not a module constant.
    """
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(
            value=35.0, timestamp=_BASE_TIME, max_age_seconds=10
        )
    }
    just_over_10s = _BASE_TIME + timedelta(seconds=11)
    assert _EVALUATOR.evaluate(rule, snapshot, just_over_10s, state) is None


def test_custom_max_age_seconds_can_stay_fresh_longer_than_the_default() -> None:
    """A signal with a looser bound (e.g. an "on_change" catalog metric) must
    stay fresh well past the 90s default.
    """
    rule = _rule(_leaf(">", 30.0))
    state = RuleState()
    snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(
            value=35.0, timestamp=_BASE_TIME, max_age_seconds=24 * 60 * 60
        )
    }
    well_past_90s = _BASE_TIME + timedelta(seconds=3600)
    assert _EVALUATOR.evaluate(rule, snapshot, well_past_90s, state) is not None


def test_leaf_states_are_independent() -> None:
    """One leaf's hysteresis latch must not affect another leaf's — each
    predicate stabilizes its own contribution independently.
    """
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [
            _leaf(">", 30.0, hysteresis=2.0, metric="temperature"),
            _leaf(">", 100.0, hysteresis=5.0, metric="humidity"),
        ],
    }
    rule = _rule(condition)
    state = RuleState()
    snapshot, now = _multi_at({"temperature": (35.0, 0), "humidity": (10.0, 0)})
    _EVALUATOR.evaluate(rule, snapshot, now, state)

    assert state.leaf_states[(0,)].latched_true is True
    assert state.leaf_states[(1,)].latched_true is False


def test_and_duration_and_cooldown_apply_to_combined_result_not_per_leaf() -> None:
    """for_duration/cooldown are rule-level (decision: applied to the tree's
    combined result), not per predicate — the hold timer only starts once
    *both* predicates are simultaneously true.
    """
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [_leaf(">", 30.0, metric="temperature"), _leaf("<", 40.0, metric="humidity")],
    }
    rule = _rule(condition, for_duration=5)
    state = RuleState()

    # temperature satisfied alone for a while — must not start the hold timer.
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (35.0, 0), "humidity": (50.0, 0)}), state) is None
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (35.0, 10), "humidity": (50.0, 10)}), state) is None
    assert state.condition_since is None

    # Now both true — the 5s hold starts from here, not from t=0.
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (35.0, 11), "humidity": (35.0, 11)}), state) is None
    assert _EVALUATOR.evaluate(rule, *_multi_at({"temperature": (35.0, 15), "humidity": (35.0, 15)}), state) is None
    action = _EVALUATOR.evaluate(
        rule, *_multi_at({"temperature": (35.0, 16), "humidity": (35.0, 16)}), state
    )
    assert action is not None


# ---- Multi-device conditions ------------------------------------------------


def test_multi_device_and_reads_each_leaf_from_its_own_device() -> None:
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [
            _leaf(">", 80.0, metric="temperature", device_id=_DEVICE_A),
            _leaf(">", 120.0, metric="pressure", device_id=_DEVICE_B),
        ],
    }
    rule = _rule(condition)
    state = RuleState()
    now = _BASE_TIME + timedelta(seconds=1)
    snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(85.0, now),
        SignalKey(_DEVICE_B, "pressure"): MetricValue(90.0, now),
    }
    assert _EVALUATOR.evaluate(rule, snapshot, now, state) is None  # pressure not met

    snapshot[SignalKey(_DEVICE_B, "pressure")] = MetricValue(130.0, now)
    assert _EVALUATOR.evaluate(rule, snapshot, now, state) is not None


def test_same_metric_name_on_two_devices_is_not_confused() -> None:
    condition = {
        "kind": "group",
        "op": "AND",
        "predicates": [
            _leaf(">", 30.0, metric="temperature", device_id=_DEVICE_A),
            _leaf("<", 10.0, metric="temperature", device_id=_DEVICE_B),
        ],
    }
    rule = _rule(condition)
    state = RuleState()
    now = _BASE_TIME
    snapshot = {
        SignalKey(_DEVICE_A, "temperature"): MetricValue(35.0, now),
        SignalKey(_DEVICE_B, "temperature"): MetricValue(5.0, now),
    }
    assert _EVALUATOR.evaluate(rule, snapshot, now, state) is not None


# ---- execution_policy strategies ------------------------------------------


def test_continuous_strategy_refires_every_evaluation_subject_to_cooldown() -> None:
    rule = _rule(_leaf(">", 30.0), strategy="continuous", cooldown=10)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is not None
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 5), state) is None  # cooldown
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 11), state) is not None  # still true -> refires


def test_reset_condition_holds_disarmed_until_reset_tree_true() -> None:
    reset = _leaf("<", 20.0)
    rule = _rule(_leaf(">", 30.0), strategy="reset_condition", reset_condition=reset)
    state = RuleState()
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 0), state) is not None
    # Drops below the bare threshold — but "edge" re-arm doesn't apply here.
    assert _EVALUATOR.evaluate(rule, *_at(25.0, 1), state) is None
    assert state.armed is False
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 2), state) is None  # still disarmed
    # Reset condition met (< 20) -> re-arms.
    assert _EVALUATOR.evaluate(rule, *_at(15.0, 3), state) is None
    assert state.armed is True
    assert _EVALUATOR.evaluate(rule, *_at(35.0, 4), state) is not None
