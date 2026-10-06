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
        "When: every reading → every day at 08:00 (Europe/Madrid)",
        "Condition changed",
        "Behaviour: Fire once per crossing → Latch until reset",
        "Actions: 1 → 2",
    ]


def test_cron_human_matches_the_editor_wording() -> None:
    from app.rules.versions import cron_human

    assert cron_human("0 22 * * *") == "every day at 22:00"
    assert cron_human("30 7 * * 2,4") == "Tue, Thu at 07:30"
    assert cron_human("0 8 * * 1-5") == "weekdays at 08:00"
    assert cron_human("*/15 * * * *") == "every 15 min"
    assert cron_human("0 9 1 * *") == "on the 1st of each month at 09:00"
    assert cron_human("5 */2 * * *") == "every 2 hours at :05"
    assert cron_human("0 8,20 * * *") == "0 8,20 * * *"  # unusual: kept as cron
