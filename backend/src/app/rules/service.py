"""Rule CRUD, the worker-side in-memory rule cache (keyed by
(device_id, metric) signal, reloaded on Redis pub/sub invalidation — see
rule_cache_loop in app/worker.py), the in-memory last-known-value cache
multi-device conditions read from, and hot-path evaluation/dispatch.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, NamedTuple

import aiomqtt
import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.commands import service as commands_service
from app.db import add_post_commit_callback
from app.notifications import service as notifications_service
from app.redis import redis_client
from app.rules.evaluators import (
    Evaluator,
    MetricSnapshot,
    MetricValue,
    RuleState,
    SignalKey,
    ThresholdEvaluator,
    referenced_signals,
)
from app.rules.models import Rule, RuleDevice, RuleDeviceRole, RuleType

log = logging.getLogger("rules")

RULES_INVALIDATE_CHANNEL = "rules:invalidate"

# The one staleness bound this codebase used to hardcode twice (once here,
# once as devices.device_offline_after_seconds — see evaluators.py's old
# STALE_METRIC_AGE_SECONDS). Now the fallback for any (device, metric) signal
# health_monitor_loop hasn't computed a catalog-derived bound for yet
# (worker startup race, or no matching catalog metric) — see
# reload_staleness_thresholds below and app.health.service's derivation.
DEFAULT_STALE_METRIC_AGE_SECONDS = 90

_THRESHOLD_EVALUATOR: Evaluator = ThresholdEvaluator()

# Mirrors frontend/src/components/rules/RuleSummary.tsx's OPERATOR_WORDS —
# keep the two in sync if either wording changes.
_OPERATOR_WORDS: dict[str, str] = {
    ">": "goes above",
    ">=": "reaches or exceeds",
    "<": "drops below",
    "<=": "falls to or below",
    "==": "equals",
    "!=": "is different from",
}

_DEFAULT_POLICY: dict[str, Any] = {
    "strategy": "edge",
    "for_duration": 0,
    "cooldown": 0,
    "reset_condition": None,
}


class RuleNotFoundError(Exception):
    pass


class RuleValidationError(Exception):
    """A rule references a device that isn't in the tenant (or doesn't exist)."""


# ---- Condition helpers ----------------------------------------------------


def _leaf_signal_key(leaf: dict[str, Any]) -> SignalKey:
    return SignalKey(str(leaf["device_id"]), leaf["metric"])


def _leaf_summary(leaf: dict[str, Any], snapshot: MetricSnapshot) -> str:
    op = _OPERATOR_WORDS.get(leaf["operator"], leaf["operator"])
    current = snapshot.get(_leaf_signal_key(leaf))
    current_clause = f" (currently {current.value})" if current is not None else ""
    return f"{leaf['metric']} {op} {leaf['threshold']}{current_clause}"


def _condition_summary(condition: dict[str, Any], snapshot: MetricSnapshot) -> str:
    if condition["kind"] == "leaf":
        return _leaf_summary(condition, snapshot)
    joiner = " and " if condition["op"] == "AND" else " or "
    return joiner.join(_condition_summary(child, snapshot) for child in condition["predicates"])


def _plain_summary(condition: dict[str, Any]) -> str:
    """No snapshot — used to auto-name a rule created without an explicit name."""
    if condition["kind"] == "leaf":
        op = _OPERATOR_WORDS.get(condition["operator"], condition["operator"])
        return f"{condition['metric']} {op} {condition['threshold']}"
    joiner = " and " if condition["op"] == "AND" else " or "
    return joiner.join(_plain_summary(child) for child in condition["predicates"])


def _auto_name(condition: dict[str, Any]) -> str:
    summary = _plain_summary(condition)
    summary = summary[0].upper() + summary[1:] if summary else "Rule"
    return summary[:200]


def _default_message(rule: Rule, snapshot: MetricSnapshot) -> str:
    return f"{_condition_summary(rule.condition, snapshot)}."


def _stamp_condition_device(node: dict[str, Any], device_id: uuid.UUID) -> dict[str, Any]:
    """Fill in a leaf's `device_id` from the path device (the device-scoped
    wrapper endpoint) — a canonical POST /rules leaf already carries its own.
    """
    if node.get("kind") == "leaf":
        return {**node, "device_id": str(node.get("device_id") or device_id)}
    return {
        **node,
        "predicates": [_stamp_condition_device(c, device_id) for c in node["predicates"]],
    }


def _condition_leaves(node: dict[str, Any]) -> list[dict[str, Any]]:
    if node.get("kind") == "leaf":
        return [node]
    out: list[dict[str, Any]] = []
    for child in node["predicates"]:
        out.extend(_condition_leaves(child))
    return out


def _rule_device_map(
    condition: dict[str, Any], actions: list[dict[str, Any]]
) -> dict[uuid.UUID, set[str]]:
    """device_id -> {roles} the rule references, for the rule_devices table."""
    out: dict[uuid.UUID, set[str]] = {}
    for leaf in _condition_leaves(condition):
        did = leaf.get("device_id")
        if did:
            out.setdefault(uuid.UUID(str(did)), set()).add(RuleDeviceRole.INPUT.value)
    for action in actions:
        if action.get("type") == "actuator_command" and action.get("device_id"):
            out.setdefault(uuid.UUID(str(action["device_id"])), set()).add(
                RuleDeviceRole.TARGET.value
            )
    return out


# ---- CRUD ------------------------------------------------------------------


async def _validate_devices_in_tenant(
    session: AsyncSession, tenant_id: uuid.UUID, device_ids: set[uuid.UUID]
) -> None:
    if not device_ids:
        return
    result = await session.execute(
        text("SELECT id FROM devices WHERE tenant_id = :tenant_id AND id = ANY(:ids)"),
        {"tenant_id": tenant_id, "ids": [str(d) for d in device_ids]},
    )
    found = {row[0] for row in result}
    missing = device_ids - found
    if missing:
        raise RuleValidationError(
            "rule references device(s) not in this tenant: "
            + ", ".join(sorted(str(m) for m in missing))
        )


async def _sync_rule_devices(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    device_map: dict[uuid.UUID, set[str]],
) -> None:
    await session.execute(
        text("DELETE FROM rule_devices WHERE rule_id = :rule_id"), {"rule_id": rule_id}
    )
    for device_id, roles in device_map.items():
        for role in roles:
            session.add(
                RuleDevice(tenant_id=tenant_id, rule_id=rule_id, device_id=device_id, role=role)
            )
    # Flush so a raw text() read (list_rule_device_rows) in the same
    # transaction sees these rows — ORM autoflush doesn't cover text().
    await session.flush()


def _assert_leaves_have_device(condition: dict[str, Any]) -> None:
    if any(not leaf.get("device_id") for leaf in _condition_leaves(condition)):
        raise RuleValidationError("every condition must name a device")


async def _persist_rule(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str,
    description: str | None,
    trigger: dict[str, Any],
    condition: dict[str, Any],
    execution_policy: dict[str, Any],
    actions: list[dict[str, Any]],
    editor_graph: dict[str, Any] | None,
    enabled: bool,
) -> Rule:
    _assert_leaves_have_device(condition)
    device_map = _rule_device_map(condition, actions)
    await _validate_devices_in_tenant(session, tenant_id, set(device_map))

    rule = Rule(
        tenant_id=tenant_id,
        name=name,
        description=description,
        type=RuleType.THRESHOLD.value,
        trigger=trigger,
        condition=condition,
        execution_policy=execution_policy,
        actions=actions,
        editor_graph=editor_graph,
        enabled=enabled,
    )
    session.add(rule)
    await session.flush()
    await _sync_rule_devices(session, tenant_id, rule.id, device_map)
    _publish_invalidation(session)
    return rule


async def create_rule_canonical(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str,
    description: str | None,
    trigger: dict[str, Any],
    condition: dict[str, Any],
    execution_policy: dict[str, Any],
    actions: list[dict[str, Any]],
    editor_graph: dict[str, Any] | None,
    enabled: bool,
) -> Rule:
    return await _persist_rule(
        session,
        tenant_id,
        name=name or _auto_name(condition),
        description=description,
        trigger=trigger,
        condition=condition,
        execution_policy=execution_policy,
        actions=actions,
        editor_graph=editor_graph,
        enabled=enabled,
    )


async def create_device_rule(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    *,
    name: str | None,
    condition: dict[str, Any],
    for_duration: int,
    cooldown: int,
    action: dict[str, Any] | None,
    actions: list[dict[str, Any]] | None,
    enabled: bool,
) -> Rule:
    """Backward-compatible single-device create (POST /devices/{id}/rules)."""
    stamped = _stamp_condition_device(condition, device_id)
    resolved_actions = actions if actions is not None else ([action] if action is not None else [])
    if not resolved_actions:
        raise RuleValidationError("a rule needs at least one action")
    stamped_actions = [
        {**a, "device_id": str(a.get("device_id") or device_id)}
        if a.get("type") == "actuator_command"
        else a
        for a in resolved_actions
    ]
    policy = {
        "strategy": "edge",
        "for_duration": for_duration,
        "cooldown": cooldown,
        "reset_condition": None,
    }
    return await _persist_rule(
        session,
        tenant_id,
        name=name or _auto_name(stamped),
        description=None,
        trigger={"type": "metric"},
        condition=stamped,
        execution_policy=policy,
        actions=stamped_actions,
        editor_graph=None,
        enabled=enabled,
    )


async def get_rule(session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> Rule:
    result = await session.execute(
        select(Rule).where(Rule.tenant_id == tenant_id, Rule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise RuleNotFoundError
    return rule


class RuleDeviceRow(NamedTuple):
    """One (rule, device, role) link plus the device's display name — for the
    response `devices` list. A raw text() join to `devices` so this module
    doesn't import devices/models.py (CLAUDE.md §6), the same way the old
    list_all_rules query did.
    """

    rule_id: uuid.UUID
    device_id: uuid.UUID
    role: str
    device_name: str | None


async def list_rule_device_rows(
    session: AsyncSession, tenant_id: uuid.UUID, rule_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[RuleDeviceRow]]:
    if not rule_ids:
        return {}
    result = await session.execute(
        text(
            "SELECT rd.rule_id, rd.device_id, rd.role, d.name AS device_name "
            "FROM rule_devices rd JOIN devices d ON d.id = rd.device_id "
            "WHERE rd.tenant_id = :tenant_id AND rd.rule_id = ANY(:rule_ids) "
            "ORDER BY rd.role, rd.created_at"
        ),
        {"tenant_id": tenant_id, "rule_ids": [str(r) for r in rule_ids]},
    )
    out: dict[uuid.UUID, list[RuleDeviceRow]] = {}
    for row in result.mappings().all():
        out.setdefault(row["rule_id"], []).append(RuleDeviceRow(**row))
    return out


async def list_rules(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> list[Rule]:
    """Rules this device feeds (`input`) or is commanded by (`target`)."""
    result = await session.execute(
        select(Rule)
        .where(
            Rule.tenant_id == tenant_id,
            Rule.id.in_(select(RuleDevice.rule_id).where(RuleDevice.device_id == device_id)),
        )
        .order_by(Rule.name)
    )
    return list(result.scalars().unique().all())


async def list_all_rules(session: AsyncSession, tenant_id: uuid.UUID) -> list[Rule]:
    result = await session.execute(
        select(Rule).where(Rule.tenant_id == tenant_id).order_by(Rule.name)
    )
    return list(result.scalars().all())


async def update_rule(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    *,
    name: str | None,
    description: str | None,
    trigger: dict[str, Any] | None,
    condition: dict[str, Any] | None,
    execution_policy: dict[str, Any] | None,
    actions: list[dict[str, Any]] | None,
    editor_graph: dict[str, Any] | None,
    enabled: bool | None,
    for_duration: int | None,
    cooldown: int | None,
    action: dict[str, Any] | None,
) -> Rule:
    rule = await get_rule(session, tenant_id, rule_id)
    # Fallback device for a legacy (device-less) leaf in an incoming
    # condition — the rule's current primary input device.
    existing_inputs = await session.execute(
        select(RuleDevice.device_id).where(
            RuleDevice.rule_id == rule_id, RuleDevice.role == RuleDeviceRole.INPUT.value
        )
    )
    fallback = next(iter(existing_inputs.scalars()), None)

    if name is not None:
        rule.name = name
    if description is not None:
        rule.description = description
    if trigger is not None:
        rule.trigger = trigger
    if editor_graph is not None:
        rule.editor_graph = editor_graph
    if enabled is not None:
        rule.enabled = enabled

    if condition is not None:
        rule.condition = (
            _stamp_condition_device(condition, fallback) if fallback is not None else condition
        )

    if execution_policy is not None:
        rule.execution_policy = execution_policy
    elif for_duration is not None or cooldown is not None:
        policy = {**_DEFAULT_POLICY, **rule.execution_policy}
        if for_duration is not None:
            policy["for_duration"] = for_duration
        if cooldown is not None:
            policy["cooldown"] = cooldown
        rule.execution_policy = policy

    if actions is not None:
        rule.actions = actions
    elif action is not None:
        rule.actions = [action]

    _assert_leaves_have_device(rule.condition)
    device_map = _rule_device_map(rule.condition, rule.actions)
    await _validate_devices_in_tenant(session, tenant_id, set(device_map))
    await session.flush()
    await _sync_rule_devices(session, tenant_id, rule.id, device_map)
    _publish_invalidation(session)
    return rule


async def delete_rule(session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> None:
    rule = await get_rule(session, tenant_id, rule_id)
    await session.delete(rule)  # rule_devices cascade via FK
    await session.flush()
    _publish_invalidation(session)


def _publish_invalidation(session: AsyncSession) -> None:
    """Publish the Redis reload signal only after this session's transaction
    commits — see db.add_post_commit_callback's docstring. The worker does a
    full reload on any message, so the payload is just a marker.
    """

    async def _publish() -> None:
        await redis_client.publish(RULES_INVALIDATE_CHANNEL, "reload")

    add_post_commit_callback(session, _publish)


# ---- Worker-side cache + hot path -------------------------------------------

_rule_cache: dict[SignalKey, list[Rule]] = {}
_rule_states: dict[uuid.UUID, RuleState] = {}

# Last known value per (device_id, metric), updated unconditionally on every
# telemetry message (pure dict write, zero I/O — stays in the hot-path
# budget) so a multi-device condition can synchronously read every signal it
# references, not just the one that just triggered this message.
_signal_value_cache: dict[SignalKey, MetricValue] = {}

# Per-(device_id, metric) staleness bound, derived from the metric's catalog
# publish profile and reloaded by app.worker's health_monitor_loop (see
# reload_staleness_thresholds) — a lookaside cache the hot path only ever
# reads, same discipline as _rule_cache above. Never populated inline in the
# hot path itself: that would put a DB read between message arrival and rule
# evaluation (CLAUDE.md §9 constraint 1).
_staleness_thresholds: dict[SignalKey, int] = {}


def reload_staleness_thresholds(mapping: dict[SignalKey, int]) -> None:
    """Full replace, called by health_monitor_loop after it recomputes every
    active device/metric's expected max-age from catalog data — mirrors
    load_rule_cache's full-reload-on-invalidation shape. A signal absent from
    `mapping` (worker startup race, or no matching catalog metric) falls back
    to DEFAULT_STALE_METRIC_AGE_SECONDS wherever it's looked up below.
    """
    _staleness_thresholds.clear()
    _staleness_thresholds.update(mapping)
    log.info("staleness thresholds reloaded: %d signals", len(mapping))


async def load_rule_cache(factory: async_sessionmaker[AsyncSession]) -> None:
    """Full reload — called once at worker startup and on every
    rules:invalidate pub/sub message. Simple and correct at 500-1000 device
    scale; no need for partial/targeted reload.
    """
    async with factory() as session:
        result = await session.execute(text("SELECT * FROM list_enabled_rules()"))
        rows = result.mappings().all()

    new_cache: dict[SignalKey, list[Rule]] = {}
    for row in rows:
        rule = Rule(
            id=row["id"],
            tenant_id=row["tenant_id"],
            name=row["name"],
            description=row["description"],
            type=row["type"],
            trigger=row["trigger"],
            condition=row["condition"],
            execution_policy=row["execution_policy"],
            actions=row["actions"],
            editor_graph=row["editor_graph"],
            enabled=row["enabled"],
        )
        for signal in referenced_signals(rule.condition):
            new_cache.setdefault(signal, []).append(rule)
    _rule_cache.clear()
    _rule_cache.update(new_cache)
    log.info("rule cache reloaded: %d active rules", len(rows))


def _snapshot_for_signals(signals: set[SignalKey]) -> MetricSnapshot:
    snapshot: MetricSnapshot = {}
    for signal in signals:
        value = _signal_value_cache.get(signal)
        if value is not None:
            snapshot[signal] = value
    return snapshot


async def evaluate_and_dispatch(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tenant_slug: str,
    device_slug: str,
    metric: str,
    value: float,
    timestamp: datetime,
) -> None:
    """The hot path: in-memory cache lookup, pure evaluation, then dispatch.
    Runs before the storage-path Redis XADD (see app/worker.py::handle_message)
    — CLAUDE.md §9 constraint 1.

    Both the evaluator call and each dispatch are wrapped defensively: this
    runs inside the single shared MQTT message loop for every device, so one
    malformed rule or one failed dispatch must never stop evaluation for
    other rules on this reading, or ingestion for every other device.
    """
    signal = SignalKey(str(device_id), metric)
    max_age = _staleness_thresholds.get(signal, DEFAULT_STALE_METRIC_AGE_SECONDS)
    _signal_value_cache[signal] = MetricValue(
        value=value, timestamp=timestamp, max_age_seconds=max_age
    )

    rules = _rule_cache.get(signal)
    if not rules:
        return

    for rule in rules:
        needed = referenced_signals(rule.condition)
        snapshot = _snapshot_for_signals(needed)
        state = _rule_states.setdefault(rule.id, RuleState())
        try:
            firing = _THRESHOLD_EVALUATOR.evaluate(rule, snapshot, timestamp, state)
        except Exception:
            log.exception("evaluator raised for rule %s -- treating as no-fire", rule.id)
            continue
        if firing is None:
            continue
        try:
            await _dispatch_actions(
                client,
                factory,
                tenant_id,
                device_id,
                tenant_slug,
                device_slug,
                timestamp,
                snapshot,
                rule,
            )
        except Exception:
            log.exception("dispatch failed for rule %s", rule.id)


async def _resolve_target(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    trigger_device_id: uuid.UUID,
    trigger_tenant_slug: str,
    trigger_device_slug: str,
    action_device_id: str | None,
) -> tuple[uuid.UUID, str, str] | None:
    """(device_id, tenant_slug, device_slug) for an actuator action's target.
    None (skip the action) if the target isn't a live device in this tenant.
    """
    if not action_device_id or str(action_device_id) == str(trigger_device_id):
        return trigger_device_id, trigger_tenant_slug, trigger_device_slug
    async with factory() as session:
        result = await session.execute(
            text(
                "SELECT device_id, tenant_id, tenant_slug, device_slug, status "
                "FROM lookup_rule_dispatch_targets(:ids)"
            ),
            {"ids": [str(action_device_id)]},
        )
        row = result.mappings().first()
    if row is None or row["tenant_id"] != tenant_id or row["status"] != "active":
        log.warning("dropping actuator action for unusable target device %s", action_device_id)
        return None
    return row["device_id"], row["tenant_slug"], row["device_slug"]


async def _dispatch_actions(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tenant_slug: str,
    device_slug: str,
    timestamp: datetime,
    snapshot: MetricSnapshot,
    rule: Rule,
) -> None:
    trigger_device_id = device_id
    for action in rule.actions:
        action_type = action.get("type")
        try:
            if action_type == "actuator_command":
                target = await _resolve_target(
                    factory,
                    tenant_id,
                    device_id,
                    tenant_slug,
                    device_slug,
                    action.get("device_id"),
                )
                if target is None:
                    continue
                target_id, target_tenant_slug, target_device_slug = target
                await commands_service.dispatch_command(
                    client,
                    factory,
                    tenant_id,
                    target_id,
                    rule.id,
                    timestamp,
                    target_tenant_slug,
                    target_device_slug,
                    actuator=action["actuator"],
                    value=action["value"],
                )
            elif action_type == "webhook":
                async with httpx.AsyncClient(timeout=5) as http_client:
                    await http_client.post(action["url"], json=action.get("body", {}))
            elif action_type != "notification":
                log.warning("unknown action type %r for rule %s", action_type, rule.id)
        except httpx.HTTPError as exc:
            log.warning("webhook dispatch failed for rule %s: %s", rule.id, exc)
        except Exception:
            log.exception("action %r failed for rule %s", action_type, rule.id)

    # A notification row is written for every firing regardless of the rule's
    # configured actions — this is what answers "did anything cross a
    # threshold". A `notification`-type action supplies its own message;
    # otherwise one is auto-generated.
    notif = next((a for a in rule.actions if a.get("type") == "notification"), None)
    message = notif["message"] if notif is not None else _default_message(rule, snapshot)
    try:
        await notifications_service.create_notification(
            factory, tenant_id, trigger_device_id, rule.id, message
        )
    except Exception:
        log.exception("notification write failed for rule %s", rule.id)
