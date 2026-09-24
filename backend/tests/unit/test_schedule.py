"""Unit tests for app.rules.service.schedule_due — pure cron matching in the
rule's timezone. No DB.
"""

import uuid
from datetime import UTC, datetime

from app.rules.models import Rule
from app.rules.service import schedule_due


def _rule(cron: str, timezone: str = "UTC") -> Rule:
    return Rule(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="scheduled",
        type="threshold",
        trigger={"type": "schedule", "cron": cron, "timezone": timezone},
        condition={
            "kind": "leaf",
            "device_id": str(uuid.uuid4()),
            "metric": "x",
            "operator": ">",
            "rhs": {"source": "static", "value": 1.0},
        },
        execution_policy={"strategy": "edge", "for_duration": 0, "cooldown": 0},
        actions=[],
        enabled=True,
    )


def test_daily_0800_matches_only_at_that_minute_utc() -> None:
    rule = _rule("0 8 * * *")
    assert schedule_due(rule, datetime(2026, 6, 1, 8, 0, tzinfo=UTC)) is True
    assert schedule_due(rule, datetime(2026, 6, 1, 8, 1, tzinfo=UTC)) is False
    assert schedule_due(rule, datetime(2026, 6, 1, 7, 59, tzinfo=UTC)) is False


def test_every_15_minutes() -> None:
    rule = _rule("*/15 * * * *")
    assert schedule_due(rule, datetime(2026, 6, 1, 12, 30, tzinfo=UTC)) is True
    assert schedule_due(rule, datetime(2026, 6, 1, 12, 31, tzinfo=UTC)) is False


def test_timezone_is_honoured() -> None:
    # 08:00 America/New_York in June (EDT, UTC-4) == 12:00 UTC
    rule = _rule("0 8 * * *", "America/New_York")
    assert schedule_due(rule, datetime(2026, 6, 1, 12, 0, tzinfo=UTC)) is True
    assert schedule_due(rule, datetime(2026, 6, 1, 8, 0, tzinfo=UTC)) is False


def test_bad_cron_or_timezone_returns_false() -> None:
    assert schedule_due(_rule("not a cron"), datetime(2026, 6, 1, 8, 0, tzinfo=UTC)) is False
    assert (
        schedule_due(_rule("0 8 * * *", "Mars/Olympus"), datetime(2026, 6, 1, 8, 0, tzinfo=UTC))
        is False
    )
