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
from typing import Any, Literal, NamedTuple, Protocol

SignalState = Literal["fresh", "stale", "missing"]

from app.rules.models import Rule

# The staleness fallback for any (device, metric) with no catalog-derived
# bound yet (worker startup race, or no matching catalog metric). Lives here —
# not in rules/service.py — so app.health.service can import it without a
# circular dependency (health.service <-> rules.service). Kept in sync with
# MetricValue.max_age_seconds' own literal default below.
DEFAULT_STALE_METRIC_AGE_SECONDS = 90

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
    """Per-rule, in-process, in-memory. Checkpointed to Redis every
    rules_maintenance_interval_seconds and restored at worker startup
    (rules/service.py's snapshot_rule_states / restore_rule_states) — so a
    normal restart no longer resets armed/cooldown/for_duration progress; a
    hard crash between checkpoints still loses up to one interval. Not reset
    when the rule cache reloads; only a deleted rule's state goes stale and
    unreferenced, which is harmless.
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


def _signal_state(metric_value: MetricValue | None, now: datetime) -> SignalState:
    """Whether a snapshot entry is usable for evaluation right now. The one
    definition of "stale" — shared by _evaluate_leaf (which collapses stale
    and missing into a False leaf) and explain_condition (which keeps the
    distinction for the simulate UI)."""
    if metric_value is None:
        return "missing"
    if (now - metric_value.timestamp).total_seconds() > metric_value.max_age_seconds:
        return "stale"
    return "fresh"


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
    if metric_value is None or _signal_state(metric_value, now) != "fresh":
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


def evaluate_condition(condition: dict[str, Any], snapshot: MetricSnapshot, now: datetime) -> bool:
    """A one-shot "is this condition tree true right now" check — throwaway
    leaf states, so no hysteresis-latch persistence and none of the
    rule-level for_duration / cooldown / armed gates. Used by the manual
    "Run now" path (rules/service.py), which deliberately bypasses flapping
    protection — the same trust tier as a manual actuator toggle. The
    automated schedule path uses the full ThresholdEvaluator instead.
    """
    return _evaluate_node(condition, snapshot, now, {}, ())


def explain_condition(
    condition: dict[str, Any], snapshot: MetricSnapshot, now: datetime
) -> dict[str, Any]:
    """The same one-shot walk as evaluate_condition, but returns an annotated
    tree instead of a bare bool — every leaf carries the value it saw, that
    signal's freshness, and its own result; every group carries its op and
    combined result. Throwaway leaf states (no hysteresis persistence), same
    trust tier as the "Run now" path. Pure. Powers POST /rules/{id}/simulate.
    """
    if condition["kind"] == "leaf":
        signal = _leaf_signal(condition)
        metric_value = snapshot.get(signal)
        state = _signal_state(metric_value, now)
        result = state == "fresh" and _compare(
            metric_value.value,  # type: ignore[union-attr]  # fresh => not None
            condition["operator"],
            condition["threshold"],
        )
        return {
            "kind": "leaf",
            "device_id": condition["device_id"],
            "metric": condition["metric"],
            "operator": condition["operator"],
            "threshold": condition["threshold"],
            "observed_value": metric_value.value if metric_value is not None else None,
            "observed_at": metric_value.timestamp if metric_value is not None else None,
            "signal_state": state,
            "result": bool(result),
        }

    children = [explain_condition(child, snapshot, now) for child in condition["predicates"]]
    results = [child["result"] for child in children]
    combined = all(results) if condition["op"] == "AND" else any(results)
    return {
        "kind": "group",
        "op": condition["op"],
        "result": combined,
        "predicates": children,
    }


def _path_key(path: tuple[int, ...]) -> str:
    return ".".join(str(i) for i in path)


def _leaf_states_to_dict(states: dict[tuple[int, ...], LeafState]) -> dict[str, bool]:
    return {_path_key(path): st.latched_true for path, st in states.items()}


def _leaf_states_from_dict(raw: Any) -> dict[tuple[int, ...], LeafState]:
    out: dict[tuple[int, ...], LeafState] = {}
    if not isinstance(raw, dict):
        return out
    for key, latched in raw.items():
        path = tuple(int(i) for i in key.split(".")) if key else ()
        out[path] = LeafState(latched_true=bool(latched))
    return out


def rule_state_to_dict(state: RuleState) -> dict[str, Any]:
    """Serialize a RuleState for the Redis checkpoint (rules/service.py's
    snapshot_rule_states). datetimes -> isoformat; the tuple-of-int leaf-state
    paths -> dotted strings ("" for the root leaf)."""
    return {
        "condition_since": state.condition_since.isoformat() if state.condition_since else None,
        "armed": state.armed,
        "last_fired_at": state.last_fired_at.isoformat() if state.last_fired_at else None,
        "leaf_states": _leaf_states_to_dict(state.leaf_states),
        "reset_leaf_states": _leaf_states_to_dict(state.reset_leaf_states),
    }


def rule_state_from_dict(raw: Any) -> RuleState:
    """Inverse of rule_state_to_dict. Anything malformed -> a fresh RuleState
    (a bad checkpoint entry must never crash the worker's restore)."""
    if not isinstance(raw, dict):
        return RuleState()

    def _dt(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    return RuleState(
        condition_since=_dt(raw.get("condition_since")),
        armed=bool(raw.get("armed", True)),
        last_fired_at=_dt(raw.get("last_fired_at")),
        leaf_states=_leaf_states_from_dict(raw.get("leaf_states")),
        reset_leaf_states=_leaf_states_from_dict(raw.get("reset_leaf_states")),
    )


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
