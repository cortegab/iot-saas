"""Which (device, metric) signals a rule reads (rules.service.rule_signals) and
which devices it touches (_rule_device_map): a reset_condition's own signals
count, or the reset tree is always unknown and the rule never re-arms."""

import uuid
from typing import Any

from app.rules import service as rules_service
from app.rules.evaluators import SignalKey
from app.rules.models import Rule

DEV_A = str(uuid.uuid4())
DEV_B = str(uuid.uuid4())


def _leaf(device: str, metric: str) -> dict[str, Any]:
    return {
        "kind": "leaf",
        "device_id": device,
        "metric": metric,
        "operator": ">",
        "rhs": {"source": "constant", "value": 1},
    }


def _rule(policy: dict[str, Any]) -> Rule:
    return Rule(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="r",
        type="threshold",
        trigger={"type": "metric"},
        condition=_leaf(DEV_A, "level"),
        execution_policy=policy,
        actions=[],
        clear_actions=[],
        enabled=True,
    )


def test_reset_condition_signals_are_read() -> None:
    rule = _rule({"strategy": "reset_condition", "reset_condition": _leaf(DEV_B, "button")})
    assert rule_signals_of(rule) == {SignalKey(DEV_A, "level"), SignalKey(DEV_B, "button")}


def test_rule_without_reset_reads_only_its_condition() -> None:
    assert rule_signals_of(_rule({"strategy": "edge"})) == {SignalKey(DEV_A, "level")}


def test_reset_condition_device_counts_as_an_input() -> None:
    device_map = rules_service._rule_device_map(
        _leaf(DEV_A, "level"), [], {"type": "metric"}, [], _leaf(DEV_B, "button")
    )
    assert set(device_map) == {uuid.UUID(DEV_A), uuid.UUID(DEV_B)}


def rule_signals_of(rule: Rule) -> set[SignalKey]:
    return rules_service.rule_signals(rule)
