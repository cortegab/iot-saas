"""The rule evaluator interface and its one implementation this phase
(threshold). This is the highest-consequence logic in the codebase — CLAUDE.md
§9 constraint 7: flapping prevention must not be bypassable, and a flapping
bug cycles a physical relay and destroys hardware.

Evaluators are pure and synchronous (CLAUDE.md §5 / §9 constraint 2): no I/O,
no awaits, nothing read or written except this function's own arguments. That
is what keeps the hot path fast and what makes exhaustive testing cheap —
there is no excuse for skipping it (see tests/unit/test_rule_evaluators.py).

A condition is a tree of predicates (rules/schemas.py's ConditionLeaf/
ConditionGroup, stored as opaque JSONB on Rule.condition). Each leaf names its
own `device_id`, so a tree can span several devices; the snapshot is keyed by
`(device_id, metric)`. Per-leaf hysteresis stabilizes each predicate's own
boolean contribution (a Schmitt-trigger latch); `execution_policy`'s
`for_duration` / `cooldown` then gate the *combined* tree result, and
`strategy` decides how a fired rule re-arms.
"""

import operator as op_module
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, NamedTuple, Protocol

from app.rules.models import Rule

_COMPARATORS: dict[str, Callable[[float, float], bool]] = {
    ">": op_module.gt,
    ">=": op_module.ge,
    "<": op_module.lt,
    "<=": op_module.le,
    "==": op_module.eq,
    "!=": op_module.ne,
}


class SignalKey(NamedTuple):
    device_id: str
    metric: str


class MetricValue(NamedTuple):
    value: float
    timestamp: datetime
    # A cached value older than this is treated as unmet (fail closed) — the
    # bound varies per (device, metric), derived from the metric's catalog
    # publish profile (rules/service.py's DEFAULT_STALE_METRIC_AGE_SECONDS /
    # reload_staleness_thresholds) and set at the point this is constructed
    # (rules/service.py's evaluate_and_dispatch), not here — evaluators.py
    # only ever reads a value already present in its own arguments, keeping
    # `evaluate()` pure. The literal default below exists only so call sites
    # that don't care about staleness (most tests) need not specify it.
    max_age_seconds: int = 90


MetricSnapshot = dict[SignalKey, MetricValue]


@dataclass
class LeafState:
    """Per-leaf, in-process, in-memory only. Keyed by the leaf's position in
    the condition tree — see RuleState.leaf_states. Not reset on rule edit,
    the same tolerance RuleState itself already has (below): only a changed
    tree shape leaves a stale, unreferenced entry behind, which is harmless.
    """

    latched_true: bool = False


@dataclass
class RuleState:
    """Per-rule, in-process, in-memory only — does not survive a worker
    restart (this project's already-accepted single-host, no-HA posture).
    Not reset when the rule cache reloads; only a deleted rule's state goes
    stale and unreferenced, which is harmless.
    """

    condition_since: datetime | None = None
    armed: bool = True
    last_fired_at: datetime | None = None
    leaf_states: dict[tuple[int, ...], LeafState] = field(default_factory=dict)
    # Only used when strategy == "reset_condition".
    reset_leaf_states: dict[tuple[int, ...], LeafState] = field(default_factory=dict)


class Firing(NamedTuple):
    rule_id: uuid.UUID


class Evaluator(Protocol):
    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Firing | None: ...


def _compare(value: float, operator: str, threshold: float) -> bool:
    return _COMPARATORS[operator](value, threshold)


def _rearm_condition_met(
    operator: str, value: float, threshold: float, hysteresis: float, condition_true: bool
) -> bool:
    """Whether the value has fallen back past the hysteresis margin far enough
    to allow the rule to fire again. Direction depends on which side of the
    threshold triggers the rule. `==`/`!=` have no meaningful hysteresis
    margin — they re-arm as soon as the condition is no longer true.
    """
    if operator == ">":
        return value <= threshold - hysteresis
    if operator == ">=":
        return value < threshold - hysteresis
    if operator == "<":
        return value >= threshold + hysteresis
    if operator == "<=":
        return value > threshold + hysteresis
    return not condition_true


def _leaf_signal(leaf: dict[str, Any]) -> SignalKey:
    return SignalKey(str(leaf["device_id"]), leaf["metric"])


def referenced_signals(condition: dict[str, Any]) -> set[SignalKey]:
    """Every (device_id, metric) referenced anywhere in a condition tree —
    used both to register a rule under every signal it watches
    (rules/service.py's load_rule_cache) and to know which snapshot entries a
    rule needs when evaluating (evaluate_and_dispatch).
    """
    if condition["kind"] == "leaf":
        return {_leaf_signal(condition)}
    out: set[SignalKey] = set()
    for child in condition["predicates"]:
        out |= referenced_signals(child)
    return out


def _evaluate_leaf(
    leaf: dict[str, Any], snapshot: MetricSnapshot, now: datetime, leaf_state: LeafState
) -> bool:
    """A single predicate's hysteresis-stabilized contribution to the tree —
    a Schmitt-trigger latch: goes True on a raw threshold crossing and stays
    True (even if the raw value dips back below the bare threshold) until it
    crosses back past its own hysteresis margin. A missing or stale cached
    value evaluates False without touching the latch — a device that stops
    reporting one metric can't leave a predicate permanently stuck true.
    """
    metric_value = snapshot.get(_leaf_signal(leaf))
    if (
        metric_value is None
        or (now - metric_value.timestamp).total_seconds() > metric_value.max_age_seconds
    ):
        return False

    raw_true = _compare(metric_value.value, leaf["operator"], leaf["threshold"])

    if leaf_state.latched_true:
        if _rearm_condition_met(
            leaf["operator"], metric_value.value, leaf["threshold"], leaf["hysteresis"], raw_true
        ):
            leaf_state.latched_true = False
    elif raw_true:
        leaf_state.latched_true = True

    return leaf_state.latched_true


def _evaluate_node(
    node: dict[str, Any],
    snapshot: MetricSnapshot,
    now: datetime,
    leaf_states: dict[tuple[int, ...], LeafState],
    path: tuple[int, ...],
) -> bool:
    if node["kind"] == "leaf":
        return _evaluate_leaf(node, snapshot, now, leaf_states.setdefault(path, LeafState()))

    results = [
        _evaluate_node(child, snapshot, now, leaf_states, path + (i,))
        for i, child in enumerate(node["predicates"])
    ]
    return all(results) if node["op"] == "AND" else any(results)


class ThresholdEvaluator:
    """The only Evaluator implemented this phase (CLAUDE.md §5's `type:
    "threshold"`). `state` is mutated in place — that mutation *is* the pure
    contract (no I/O, nothing outside the four arguments touched), not a
    violation of it.

    Control flow: tree eval -> re-arm -> duration-hold -> armed-check ->
    cooldown-check -> fire. Per-leaf hysteresis already debounces rapid
    dithering, so rule-level `armed` is pure edge-detection.

    `strategy` decides re-arm:
      - "edge" (default): re-arm once the combined tree goes false again.
      - "continuous": re-arm every evaluation (fire repeatedly, subject to
        `cooldown`).
      - "reset_condition": stay disarmed until `policy["reset_condition"]`
        evaluates true (independent of the tree going false).
    """

    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Firing | None:
        policy = rule.execution_policy
        strategy: str = policy.get("strategy", "edge")
        for_duration: int = policy.get("for_duration", 0)
        cooldown: int = policy.get("cooldown", 0)

        tree_true = _evaluate_node(rule.condition, snapshot, now, state.leaf_states, ())

        if not state.armed:
            if strategy == "continuous":
                state.armed = True
            elif strategy == "reset_condition":
                reset = policy.get("reset_condition")
                if reset is not None:
                    if _evaluate_node(reset, snapshot, now, state.reset_leaf_states, ()):
                        state.armed = True
                elif not tree_true:
                    state.armed = True
            elif not tree_true:  # "edge"
                state.armed = True

        if not tree_true:
            state.condition_since = None
            return None

        if state.condition_since is None:
            state.condition_since = now
        held_for = (now - state.condition_since).total_seconds()
        if held_for < for_duration:
            return None

        if not state.armed:
            return None

        if state.last_fired_at is not None:
            since_last_fire = (now - state.last_fired_at).total_seconds()
            if since_last_fire < cooldown:
                return None

        state.armed = False
        state.last_fired_at = now
        return Firing(rule_id=rule.id)
