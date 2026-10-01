"""Unit tests for rule version change lines — plain-language diffs of the
saved definition (app.rules.versions.change_lines)."""

from typing import Any

from app.rules.versions import change_lines


def _snap(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "name": "Too hot",
        "description": None,
        "enabled": True,
        "trigger": {"type": "metric"},
        "condition": {
            "kind": "leaf",
            "metric": "temperature",
            "operator": ">",
            "rhs": {"source": "static", "value": 30},
        },
        "execution_policy": {
            "strategy": "edge",
            "for_duration": 10,
            "cooldown": 60,
            "reset_condition": None,
            "clear_for_duration": 0,
        },
        "actions": [{"type": "actuator_command", "actuator": "fan1", "value": True}],
        "clear_actions": [],
    }
    return {**base, **over}


def test_first_version_is_created() -> None:
    assert change_lines(None, _snap()) == ["Created"]


def test_identical_save_has_no_lines() -> None:
    assert change_lines(_snap(), _snap()) == []


def test_rename_enable_and_timings() -> None:
    before = _snap()
    after = _snap(
        name="Hot",
        enabled=False,
        execution_policy={**before["execution_policy"], "cooldown": 120, "for_duration": 0},
    )
    assert change_lines(before, after) == [
        'Renamed "Too hot" → "Hot"',
        "Disabled",
        "Hold for: 10 s → off",
        "Cooldown: 1 min → 2 min",
    ]


def test_schedule_strategy_and_actions() -> None:
    before = _snap()
    after = _snap(
        trigger={"type": "schedule", "cron": "0 8 * * *", "timezone": "Europe/Madrid"},
        condition=None,
        execution_policy={**before["execution_policy"], "strategy": "latch"},
        actions=[*before["actions"], {"type": "notification", "message": "x"}],
    )
    assert change_lines(before, after) == [
        "When: every reading → schedule 0 8 * * * (Europe/Madrid)",
        "Condition changed",
        "Behaviour: Fire once per crossing → Latch until reset",
        "Actions: 1 → 2",
    ]
