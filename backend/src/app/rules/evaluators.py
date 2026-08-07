"""The rule evaluator interface and its one implementation this phase
(threshold). This is the highest-consequence logic in the codebase — CLAUDE.md
§9 constraint 7: flapping prevention must not be bypassable, and a flapping
bug cycles a physical relay and destroys hardware.

Evaluators are pure and synchronous (CLAUDE.md §5 / §9 constraint 2): no I/O,
no awaits, nothing read or written except this function's own arguments. That
is what keeps the hot path fast and what makes exhaustive testing cheap —
there is no excuse for skipping it (see tests/unit/test_rule_evaluators.py).

A condition is a tree of predicates (rules/schemas.py's ConditionLeaf/
ConditionGroup, stored as opaque JSONB on Rule.condition). Per-leaf hysteresis
stabilizes each predicate's own boolean contribution (a Schmitt-trigger
latch); `for_duration`/`cooldown` then gate the *combined* tree result at the
rule level, exactly as the old single-metric evaluator gated one comparison.
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

# A cached metric value older than this is treated as unmet (fail closed) —
# matches devices.device_offline_after_seconds, the existing online/offline
# threshold: a predicate goes stale at the same moment the device itself
# would show "offline". A rule can't fire on a device that's only partially
# reporting.
STALE_METRIC_AGE_SECONDS = 90


class MetricValue(NamedTuple):
    value: float
    timestamp: datetime


MetricSnapshot = dict[str, MetricValue]


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


class Action(NamedTuple):
    rule_id: uuid.UUID
    action_type: str
    payload: dict[str, Any]


class Evaluator(Protocol):
    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Action | None: ...


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
    if operator in (">", ">="):
        return value <= threshold - hysteresis
    if operator in ("<", "<="):
        return value >= threshold + hysteresis
    return not condition_true


def referenced_metrics(condition: dict[str, Any]) -> set[str]:
    """Every metric name referenced anywhere in a condition tree — used both
    to register a rule under every metric it watches (rules/service.py's
    load_rule_cache) and to know which snapshot entries a rule needs when
    evaluating (evaluate_and_dispatch).
    """
    if condition["kind"] == "leaf":
        return {condition["metric"]}
    out: set[str] = set()
    for child in condition["predicates"]:
        out |= referenced_metrics(child)
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
    metric_value = snapshot.get(leaf["metric"])
    if (
        metric_value is None
        or (now - metric_value.timestamp).total_seconds() > STALE_METRIC_AGE_SECONDS
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
    """The only Evaluator implemented in Phase 3 (CLAUDE.md §5's `type:
    "threshold"`). `state` is mutated in place — that mutation *is* the pure
    contract described above, not a violation of it: nothing outside this
    function's own arguments (rule, snapshot, now, state) is read or written,
    and there is no I/O anywhere in this call.

    Control flow mirrors the single-metric evaluator this replaced almost
    line-for-line: duration-hold -> armed-check -> cooldown-check -> fire. The
    only structural change is that the single scalar comparison becomes a
    recursive tree evaluation (_evaluate_node); per-leaf hysteresis already
    debounces rapid dithering before this level ever sees it, so rule-level
    re-arm (`armed`) is now pure edge-detection, no magnitude check needed
    here.
    """

    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Action | None:
        tree_true = _evaluate_node(rule.condition, snapshot, now, state.leaf_states, ())

        if not state.armed and not tree_true:
            state.armed = True

        if not tree_true:
            state.condition_since = None
            return None

        if state.condition_since is None:
            state.condition_since = now
        held_for = (now - state.condition_since).total_seconds()
        if held_for < rule.for_duration:
            return None

        if not state.armed:
            return None

        if state.last_fired_at is not None:
            since_last_fire = (now - state.last_fired_at).total_seconds()
            if since_last_fire < rule.cooldown:
                return None

        state.armed = False
        state.last_fired_at = now
        return Action(rule_id=rule.id, action_type=rule.action["type"], payload=rule.action)
