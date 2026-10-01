"""Rule version history (DESIGN.md §9 Versions): a snapshot of each saved
rule plus plain-language change lines, written by the API in the same
transaction as the save. Never imported by the worker's hot path.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rules.models import Rule, RuleVersion

# The fields that define a rule's behaviour. `editor_graph` is layout only,
# so moving a ladder node isn't a new version.
SNAPSHOT_FIELDS = (
    "name",
    "description",
    "enabled",
    "trigger",
    "condition",
    "execution_policy",
    "actions",
    "clear_actions",
)

_STRATEGY = {
    "edge": "Fire once per crossing",
    "continuous": "Fire while it holds",
    "reset_condition": "Fire, then wait for a reset condition",
    "latch": "Latch until reset",
}


def snapshot_of(rule: Rule) -> dict[str, Any]:
    return {f: getattr(rule, f) for f in SNAPSHOT_FIELDS}


def _seconds(v: object) -> str:
    n = int(v) if isinstance(v, (int, float)) else 0
    if n == 0:
        return "off"
    if n % 3600 == 0:
        return f"{n // 3600} h"
    if n % 60 == 0:
        return f"{n // 60} min"
    return f"{n} s"


def _trigger_text(t: dict[str, Any]) -> str:
    kind = t.get("type", "metric")
    if kind == "schedule":
        return f"schedule {t.get('cron', '?')} ({t.get('timezone', 'UTC')})"
    if kind == "device_status":
        return f"device {t.get('transition', '?')}"
    return {"metric": "every reading", "manual": "manual only"}.get(kind, str(kind))


def _actions_line(label: str, a: list[Any], b: list[Any]) -> str:
    if len(a) != len(b):
        return f"{label}: {len(a)} → {len(b)}"
    return f"{label} changed"


def change_lines(before: dict[str, Any] | None, after: dict[str, Any]) -> list[str]:
    """What changed, in the words the editor uses. Empty means nothing that
    affects behaviour changed (no new version is written)."""
    if before is None:
        return ["Created"]
    lines: list[str] = []
    if before["name"] != after["name"]:
        lines.append(f'Renamed "{before["name"]}" → "{after["name"]}"')
    if before["enabled"] != after["enabled"]:
        lines.append("Enabled" if after["enabled"] else "Disabled")
    if (before.get("description") or "") != (after.get("description") or ""):
        lines.append("Description changed")
    tb, ta = before.get("trigger") or {}, after.get("trigger") or {}
    if tb != ta:
        lines.append(f"When: {_trigger_text(tb)} → {_trigger_text(ta)}")
    if before.get("condition") != after.get("condition"):
        lines.append("Condition changed")
    pb, pa = before.get("execution_policy") or {}, after.get("execution_policy") or {}
    if pb.get("strategy") != pa.get("strategy"):
        lines.append(
            f"Behaviour: {_STRATEGY.get(str(pb.get('strategy')), pb.get('strategy'))}"
            f" → {_STRATEGY.get(str(pa.get('strategy')), pa.get('strategy'))}"
        )
    for key, label in (
        ("for_duration", "Hold for"),
        ("cooldown", "Cooldown"),
        ("clear_for_duration", "Clear after"),
    ):
        if (pb.get(key) or 0) != (pa.get(key) or 0):
            lines.append(f"{label}: {_seconds(pb.get(key))} → {_seconds(pa.get(key))}")
    if pb.get("reset_condition") != pa.get("reset_condition"):
        lines.append("Reset condition changed")
    if before.get("actions") != after.get("actions"):
        lines.append(
            _actions_line("Actions", before.get("actions") or [], after.get("actions") or [])
        )
    if before.get("clear_actions") != after.get("clear_actions"):
        lines.append(
            _actions_line(
                "On-clear actions",
                before.get("clear_actions") or [],
                after.get("clear_actions") or [],
            )
        )
    return lines


async def record_version(
    session: AsyncSession,
    rule: Rule,
    before: dict[str, Any] | None,
    author_id: uuid.UUID | None,
) -> RuleVersion | None:
    """Append the next version if the save changed anything; None otherwise.
    Call after the rule is flushed (it needs rule.id)."""
    after = snapshot_of(rule)
    lines = change_lines(before, after)
    if not lines:
        return None
    current = (
        await session.execute(
            select(func.max(RuleVersion.version)).where(RuleVersion.rule_id == rule.id)
        )
    ).scalar_one_or_none()
    version = RuleVersion(
        tenant_id=rule.tenant_id,
        rule_id=rule.id,
        version=(current or 0) + 1,
        snapshot=after,
        change_lines=lines,
        author_id=author_id,
    )
    session.add(version)
    await session.flush()
    return version


async def list_versions(
    session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID, limit: int = 50
) -> list[RuleVersion]:
    result = await session.execute(
        select(RuleVersion)
        .where(RuleVersion.tenant_id == tenant_id, RuleVersion.rule_id == rule_id)
        .order_by(RuleVersion.version.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
