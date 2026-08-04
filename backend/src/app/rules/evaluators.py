"""The rule evaluator interface and its one implementation this phase
(threshold). This is the highest-consequence logic in the codebase — CLAUDE.md
§9 constraint 7: flapping prevention must not be bypassable, and a flapping
bug cycles a physical relay and destroys hardware.

Evaluators are pure and synchronous (CLAUDE.md §5 / §9 constraint 2): no I/O,
no awaits, nothing read or written except this function's own arguments. That
is what keeps the hot path fast and what makes exhaustive testing cheap —
there is no excuse for skipping it (see tests/unit/test_rule_evaluators.py).
"""

import operator as op_module
import uuid
from collections.abc import Callable
from dataclasses import dataclass
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


class Reading(NamedTuple):
    device_id: uuid.UUID
    metric: str
    value: float
    timestamp: datetime


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


class Action(NamedTuple):
    rule_id: uuid.UUID
    action_type: str
    payload: dict[str, Any]


class Evaluator(Protocol):
    def evaluate(self, rule: Rule, reading: Reading, state: RuleState) -> Action | None: ...


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


class ThresholdEvaluator:
    """The only Evaluator implemented in Phase 3 (CLAUDE.md §5's `type:
    "threshold"`). `state` is mutated in place — that mutation *is* the pure
    contract described above, not a violation of it: nothing outside this
    function's own arguments (rule, reading, state) is read or written, and
    there is no I/O anywhere in this call.
    """

    def evaluate(self, rule: Rule, reading: Reading, state: RuleState) -> Action | None:
        condition_true = _compare(reading.value, rule.operator, rule.threshold)

        if not state.armed and _rearm_condition_met(
            rule.operator, reading.value, rule.threshold, rule.hysteresis, condition_true
        ):
            state.armed = True

        if not condition_true:
            state.condition_since = None
            return None

        if state.condition_since is None:
            state.condition_since = reading.timestamp
        held_for = (reading.timestamp - state.condition_since).total_seconds()
        if held_for < rule.for_duration:
            return None

        if not state.armed:
            return None

        if state.last_fired_at is not None:
            since_last_fire = (reading.timestamp - state.last_fired_at).total_seconds()
            if since_last_fire < rule.cooldown:
                return None

        state.armed = False
        state.last_fired_at = reading.timestamp
        return Action(rule_id=rule.id, action_type=rule.action["type"], payload=rule.action)
