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

Tree evaluation is three-valued: a leaf whose signal is stale or missing is
*unknown* (None), not false, and AND/OR combine with Kleene logic. Only a
known-true tree can fire and only a known-false tree can re-arm — a data gap
must never count as "the condition cleared", or a reading that returns
inside a hysteresis band would refire without ever re-crossing the threshold.
"""

import hashlib
import json
import operator as op_module
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, NamedTuple, Protocol

SignalState = Literal["fresh", "stale", "missing"]

from app.rules.models import Rule

RANGE_OPERATORS = {"between", "not_between"}
SET_OPERATORS = {"in", "not_in"}
CHANGE_OPERATORS = {"changed", "increased", "decreased"}

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
    # The one-prior reading for this signal, for changed/increased/decreased
    # (rules/service.py's _signal_value_cache shifts current -> previous on
    # each new value). None until a signal has been seen twice.
    previous_value: float | None = None
    previous_timestamp: datetime | None = None


MetricSnapshot = dict[SignalKey, MetricValue]


@dataclass
class LeafState:
    """Per-leaf, in-process, in-memory only. Keyed by the leaf's *position*
    in the condition tree (see RuleState.leaf_states), not its content — so
    an edit that changes a leaf in place would inherit the old latch. The
    caller must drop leaf states when the condition changes; rules/service.py
    does that via RuleState.condition_fingerprint.
    """

    latched_true: bool = False


@dataclass
class RuleState:
    """Per-rule, in-process, in-memory. Checkpointed to Redis every
    rules_maintenance_interval_seconds and restored at worker startup
    (rules/service.py's snapshot_rule_states / restore_rule_states) — so a
    normal restart no longer resets armed/cooldown/for_duration progress; a
    hard crash between checkpoints still loses up to one interval.

    `condition_fingerprint` identifies the condition (+ reset tree) the latch
    and hold-timer fields were built against; rules/service.py resets those
    fields when it no longer matches the live rule.
    """

    condition_since: datetime | None = None
    armed: bool = True
    last_fired_at: datetime | None = None
    leaf_states: dict[tuple[int, ...], LeafState] = field(default_factory=dict)
    # Only used when strategy == "reset_condition".
    reset_leaf_states: dict[tuple[int, ...], LeafState] = field(default_factory=dict)
    condition_fingerprint: str | None = None
    # On-clear episode: True from a firing of a rule with clear_actions until
    # its clear fires. `clear_since` is the clear_for_duration hold timer.
    active: bool = False
    clear_since: datetime | None = None


Edge = Literal["fire", "clear"]


class Firing(NamedTuple):
    rule_id: uuid.UUID
    edge: Edge = "fire"


class Evaluator(Protocol):
    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Firing | None: ...


def _compare(value: float, operator: str, threshold: float) -> bool:
    return _COMPARATORS[operator](value, threshold)


def _compare_range(operator: str, value: float, rhs: dict[str, Any]) -> bool:
    inside = rhs["low"] <= value <= rhs["high"]
    return inside if operator == "between" else not inside


def _compare_set(operator: str, value: float, rhs: dict[str, Any]) -> bool:
    member = value in rhs["values"]
    return member if operator == "in" else not member


def _compare_change(operator: str, metric_value: MetricValue) -> bool:
    """changed/increased/decreased compare a signal's latest reading against
    its own previous one — a signal seen only once (previous_value is None)
    can't have "changed" yet."""
    if metric_value.previous_value is None:
        return False
    if operator == "changed":
        return metric_value.value != metric_value.previous_value
    if operator == "increased":
        return metric_value.value > metric_value.previous_value
    return metric_value.value < metric_value.previous_value  # "decreased"


def _resolve_rhs_scalar(
    rhs: dict[str, Any], snapshot: MetricSnapshot, now: datetime
) -> tuple[float | None, SignalState]:
    """The right-hand side's value and freshness for the six scalar
    comparison operators. A `static` rhs is always fresh; a `metric` rhs is
    looked up in the same snapshot as any other signal and fails closed
    (None, "stale"/"missing") exactly like a leaf's own missing signal."""
    if rhs["source"] == "static":
        return rhs["value"], "fresh"
    rhs_value = snapshot.get(SignalKey(str(rhs["device_id"]), rhs["metric"]))
    state = _signal_state(rhs_value, now)
    if rhs_value is None or state != "fresh":
        return None, state
    return rhs_value.value, state


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


def referenced_signals(condition: dict[str, Any] | None) -> set[SignalKey]:
    """Every (device_id, metric) referenced anywhere in a condition tree —
    used both to register a rule under every signal it watches
    (rules/service.py's load_rule_cache) and to know which snapshot entries a
    rule needs when evaluating (evaluate_and_dispatch). A metric-vs-metric
    leaf (rhs.source == "metric") also references its rhs signal, so the rule
    re-evaluates when *either* side updates. None (a condition-less
    device_status rule) references nothing.
    """
    if condition is None:
        return set()
    if condition["kind"] == "leaf":
        signals = {_leaf_signal(condition)}
        rhs = condition.get("rhs")
        if rhs is not None and rhs.get("source") == "metric":
            signals.add(SignalKey(str(rhs["device_id"]), rhs["metric"]))
        return signals
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
) -> bool | None:
    """A single predicate's contribution to the tree: True, False, or None
    (unknown). A missing or stale cached value (this leaf's own signal, or a
    metric-sourced rhs) is unknown and leaves the latch untouched — it can
    neither fire the rule nor count as the condition having cleared.

    Only the four inequality operators (>,>=,<,<=) get hysteresis-stabilized
    latching (a Schmitt trigger: goes True on a raw crossing and stays True
    until it crosses back past its own margin) — `==`/`!=` and every operator
    added in Phase 6 (between/not_between/in/not_in/changed/increased/
    decreased) have no natural symmetric margin, so they re-arm immediately
    (the latch always mirrors the raw comparison — see test coverage for why
    this is behaviorally identical to running `==`/`!=` through the general
    latch path today).
    """
    metric_value = snapshot.get(_leaf_signal(leaf))
    if metric_value is None or _signal_state(metric_value, now) != "fresh":
        return None

    operator = leaf["operator"]

    if operator in CHANGE_OPERATORS:
        raw_true = _compare_change(operator, metric_value)
    elif operator in RANGE_OPERATORS:
        raw_true = _compare_range(operator, metric_value.value, leaf["rhs"])
    elif operator in SET_OPERATORS:
        raw_true = _compare_set(operator, metric_value.value, leaf["rhs"])
    else:
        rhs_value, _rhs_state = _resolve_rhs_scalar(leaf["rhs"], snapshot, now)
        if rhs_value is None:
            return None
        raw_true = _compare(metric_value.value, operator, rhs_value)
        if leaf_state.latched_true:
            if _rearm_condition_met(
                operator, metric_value.value, rhs_value, leaf["hysteresis"], raw_true
            ):
                leaf_state.latched_true = False
        elif raw_true:
            leaf_state.latched_true = True
        return leaf_state.latched_true

    leaf_state.latched_true = raw_true
    return raw_true


def _evaluate_node(
    node: dict[str, Any],
    snapshot: MetricSnapshot,
    now: datetime,
    leaf_states: dict[tuple[int, ...], LeafState],
    path: tuple[int, ...],
) -> bool | None:
    """Kleene three-valued AND/OR. Every child is evaluated (no short-circuit)
    so every leaf's latch sees every reading."""
    if node["kind"] == "leaf":
        return _evaluate_leaf(node, snapshot, now, leaf_states.setdefault(path, LeafState()))

    results = [
        _evaluate_node(child, snapshot, now, leaf_states, path + (i,))
        for i, child in enumerate(node["predicates"])
    ]
    dominant: bool = node["op"] == "OR"  # True dominates OR; False dominates AND
    if dominant in results:
        return dominant
    if None in results:
        return None
    return not dominant


def evaluate_condition(
    condition: dict[str, Any] | None, snapshot: MetricSnapshot, now: datetime
) -> bool:
    """A one-shot "is this condition tree true right now" check — throwaway
    leaf states, so no hysteresis-latch persistence and none of the
    rule-level for_duration / cooldown / armed gates. Used by the manual
    "Run now" path (rules/service.py), which deliberately bypasses flapping
    protection — the same trust tier as a manual actuator toggle. The
    automated schedule path uses the full ThresholdEvaluator instead. A None
    condition (a condition-less device_status rule) is always true.
    """
    if condition is None:
        return True
    return _evaluate_node(condition, snapshot, now, {}, ()) is True


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
        operator = condition["operator"]
        rhs = condition.get("rhs")

        observed_rhs_value: float | None = None
        rhs_signal_state: SignalState | None = None
        result = False
        if state == "fresh":
            assert metric_value is not None  # fresh => not None
            if operator in CHANGE_OPERATORS:
                result = _compare_change(operator, metric_value)
            elif operator in RANGE_OPERATORS:
                assert rhs is not None
                result = _compare_range(operator, metric_value.value, rhs)
            elif operator in SET_OPERATORS:
                assert rhs is not None
                result = _compare_set(operator, metric_value.value, rhs)
            else:
                assert rhs is not None
                rhs_value, resolved_state = _resolve_rhs_scalar(rhs, snapshot, now)
                if rhs["source"] == "metric":
                    observed_rhs_value = rhs_value
                    rhs_signal_state = resolved_state
                if rhs_value is not None:
                    result = _compare(metric_value.value, operator, rhs_value)

        leaf: dict[str, Any] = {
            "kind": "leaf",
            "device_id": condition["device_id"],
            "metric": condition["metric"],
            "operator": operator,
            "rhs": rhs,
            "observed_value": metric_value.value if metric_value is not None else None,
            "observed_at": metric_value.timestamp if metric_value is not None else None,
            "signal_state": state,
            "result": bool(result),
        }
        if rhs is not None and rhs.get("source") == "metric":
            leaf["observed_rhs_value"] = observed_rhs_value
            leaf["rhs_signal_state"] = rhs_signal_state
        return leaf

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
        "condition_fingerprint": state.condition_fingerprint,
        "active": state.active,
        "clear_since": state.clear_since.isoformat() if state.clear_since else None,
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
        condition_fingerprint=(
            fp if isinstance(fp := raw.get("condition_fingerprint"), str) else None
        ),
        active=bool(raw.get("active", False)),
        clear_since=_dt(raw.get("clear_since")),
    )


def condition_fingerprint(rule: Rule) -> str:
    """A stable identity for everything leaf latches are keyed against: the
    condition tree plus the reset tree."""
    reset = (rule.execution_policy or {}).get("reset_condition")
    blob = json.dumps([rule.condition, reset], sort_keys=True, default=str)
    return hashlib.sha1(blob.encode(), usedforsecurity=False).hexdigest()


def align_state_to_condition(state: RuleState, fingerprint: str) -> None:
    """Drop latch and hold-timer progress built against a different condition.
    `armed` / `last_fired_at` are kept — cooldown and "already fired this
    episode" still describe the physical world after an edit. A state with no
    fingerprint yet (brand new, or a pre-fingerprint checkpoint) adopts this one.
    """
    if state.condition_fingerprint is not None and state.condition_fingerprint != fingerprint:
        state.leaf_states.clear()
        state.reset_leaf_states.clear()
        state.condition_since = None
        state.clear_since = None
    state.condition_fingerprint = fingerprint


def has_pending_timer(rule: Rule, state: RuleState) -> bool:
    """Whether a timer is running that no new reading may arrive to complete —
    an on_change switch sends one "released" reading, so its clear delay (or
    a for_duration hold) must be finished by a periodic re-evaluation instead.
    Only the first firing of a hold counts, so `continuous` refires stay
    reading-driven exactly as before."""
    policy = rule.execution_policy or {}
    if state.clear_since is not None and policy.get("clear_for_duration", 0) > 0:
        return True
    return (
        state.condition_since is not None
        and state.armed
        and policy.get("for_duration", 0) > 0
        and (state.last_fired_at is None or state.last_fired_at < state.condition_since)
    )


def reset_latch(state: RuleState) -> bool:
    """Re-arm a latched rule (POST /rules/{id}/reset). Returns whether it was
    latched. The hold timer restarts, so a condition that is still true
    re-latches only after a full `for_duration` — like a PLC set coil
    re-energising on the next scan, but still debounced."""
    was_latched = not state.armed
    state.armed = True
    state.condition_since = None
    return was_latched


class ThresholdEvaluator:
    """The only Evaluator implemented this phase (CLAUDE.md §5's `type:
    "threshold"`). `state` is mutated in place — that mutation *is* the pure
    contract (no I/O, nothing outside the four arguments touched), not a
    violation of it.

    Control flow: tree eval -> re-arm -> duration-hold -> armed-check ->
    cooldown-check -> fire. Per-leaf hysteresis already debounces rapid
    dithering, so rule-level `armed` is pure edge-detection.

    `strategy` decides re-arm:
      - "edge" (default): re-arm once the combined tree is known false again.
      - "continuous": re-arm every evaluation (fire repeatedly, subject to
        `cooldown`).
      - "reset_condition": stay disarmed until `policy["reset_condition"]`
        evaluates true (independent of the tree going false).
      - "latch": like "reset_condition", but with no reset tree it waits for
        a manual reset (`reset_latch`) instead of falling back to edge.

    An unknown tree (stale/missing data) clears the hold timer but never
    re-arms — see the module docstring.

    On-clear: a firing of a rule with `clear_actions` opens an episode
    (`state.active`). The first known-false evaluation afterwards starts the
    `clear_for_duration` timer; once it has held, one `Firing(edge="clear")`
    closes the episode. Unknown resets that timer and never clears (hold last
    state); a true reading cancels it. Cooldown never gates a clear — a relay
    must not be left on — and a clear can only follow a fire, so the toggle
    rate stays bounded by for_duration / cooldown / hysteresis (§9.7).
    """

    def evaluate(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Firing | None:
        policy = rule.execution_policy
        strategy: str = policy.get("strategy", "edge")
        for_duration: int = policy.get("for_duration", 0)
        cooldown: int = policy.get("cooldown", 0)
        clear_for_duration: int = policy.get("clear_for_duration", 0)
        has_clear = bool(rule.clear_actions)

        tree = (
            True
            if rule.condition is None
            else _evaluate_node(rule.condition, snapshot, now, state.leaf_states, ())
        )

        if not state.armed:
            if strategy == "continuous":
                state.armed = True
            elif strategy == "reset_condition":
                reset = policy.get("reset_condition")
                if reset is not None:
                    if _evaluate_node(reset, snapshot, now, state.reset_leaf_states, ()) is True:
                        state.armed = True
                elif tree is False:
                    state.armed = True
            elif strategy == "latch":
                # Never re-armed by the tree going false — only by the optional
                # reset tree here, or by reset_latch (POST /rules/{id}/reset).
                reset = policy.get("reset_condition")
                if (
                    reset is not None
                    and _evaluate_node(reset, snapshot, now, state.reset_leaf_states, ()) is True
                ):
                    state.armed = True
            elif tree is False:  # "edge"
                state.armed = True

        if tree is not True:
            state.condition_since = None
            return self._maybe_clear(rule, tree, now, state, has_clear, clear_for_duration)

        state.clear_since = None
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
        state.active = has_clear
        return Firing(rule_id=rule.id)

    def evaluate_event(
        self, rule: Rule, snapshot: MetricSnapshot, now: datetime, state: RuleState
    ) -> Firing | None:
        """A discrete event — a schedule tick or a device_status flip: fire iff
        the tree is true right now and cooldown has passed.

        Each event is its own episode, so there is no armed gate: through
        `evaluate`, a condition-less rule (tree always True) or one whose
        condition stays true between events never saw the tree go false, and
        fired once, ever. `for_duration` does not apply either — an event has
        no duration to hold across (the next tick may be a day away). Cooldown
        still applies (CLAUDE.md §9.7), leaf hysteresis still latches across
        events, and event rules carry no clear_actions (service validation),
        so there is nothing to clear.
        """
        tree = (
            True
            if rule.condition is None
            else _evaluate_node(rule.condition, snapshot, now, state.leaf_states, ())
        )
        if tree is not True:
            return None
        cooldown: int = rule.execution_policy.get("cooldown", 0)
        if (
            state.last_fired_at is not None
            and (now - state.last_fired_at).total_seconds() < cooldown
        ):
            return None
        state.last_fired_at = now
        return Firing(rule_id=rule.id)

    @staticmethod
    def _maybe_clear(
        rule: Rule,
        tree: bool | None,
        now: datetime,
        state: RuleState,
        has_clear: bool,
        clear_for_duration: int,
    ) -> Firing | None:
        if tree is None or not state.active:
            state.clear_since = None
            return None
        if not has_clear:  # clear_actions removed mid-episode
            state.active = False
            state.clear_since = None
            return None
        if state.clear_since is None:
            state.clear_since = now
        if (now - state.clear_since).total_seconds() < clear_for_duration:
            return None
        state.active = False
        state.clear_since = None
        return Firing(rule_id=rule.id, edge="clear")
