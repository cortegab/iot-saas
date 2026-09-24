"""Rule CRUD, the worker-side in-memory rule cache (keyed by
(device_id, metric) signal, reloaded on Redis pub/sub invalidation — see
rule_cache_loop in app/worker.py), the in-memory last-known-value cache
multi-device conditions read from, and hot-path evaluation/dispatch.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, NamedTuple
from zoneinfo import ZoneInfo

import aiomqtt
import redis.asyncio as redis
from croniter import CroniterError, croniter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import service as auth_service
from app.commands import service as commands_service
from app.config import settings
from app.db import add_post_commit_callback, set_tenant_context
from app.health.service import derive_max_age
from app.notifications import service as notifications_service
from app.realtime import service as realtime_service
from app.redis import redis_client
from app.rules import executors
from app.rules.evaluators import (
    DEFAULT_STALE_METRIC_AGE_SECONDS,
    Evaluator,
    MetricSnapshot,
    MetricValue,
    RuleState,
    SignalKey,
    ThresholdEvaluator,
    evaluate_condition,
    explain_condition,
    referenced_signals,
    rule_state_from_dict,
    rule_state_to_dict,
)
from app.rules.models import (
    ActionExecution,
    Rule,
    RuleDevice,
    RuleDeviceRole,
    RuleExecution,
    RuleType,
)
from app.rules.schemas import (
    RuleHealth,
    RuleSignalHealth,
    SimulateActionPreview,
    SimulateReplayResult,
    SimulateReplayWindow,
    SimulateRequest,
    SimulateResponse,
)
from app.telemetry import service as telemetry_service
from app.tenants import service as tenants_service

log = logging.getLogger("rules")

RULES_INVALIDATE_CHANNEL = "rules:invalidate"
# One out-of-band evaluation of a single rule — carries {tenant_id, rule_id,
# trigger_source}. Published by request_manual_run (POST /rules/{id}/run) and
# by app.worker's schedule_loop; consumed by app.worker's manual_command_loop.
RULES_MANUAL_CHANNEL = "rules:manual"

# Redis key holding the periodic JSON checkpoint of _rule_states (Phase 5) —
# {rule_id: rule_state_to_dict(...)}. Written by app.worker's
# rules_maintenance_loop, restored once at worker startup. Best-effort: a hard
# crash between checkpoints loses up to one interval of armed/cooldown/hold
# progress (CLAUDE.md §9 — no full state externalisation on a single host).
RULE_STATE_REDIS_KEY = "rules:state"

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


def _validate_trigger(trigger: dict[str, Any]) -> None:
    """Cron + timezone sanity for a schedule trigger — done here rather than a
    Pydantic field_validator (this schema module has no such precedent).
    Metric / manual triggers carry nothing to validate.
    """
    if trigger.get("type") != "schedule":
        return
    cron = trigger.get("cron", "")
    if not croniter.is_valid(cron):
        raise RuleValidationError(f"invalid cron expression: {cron!r}")
    try:
        ZoneInfo(trigger.get("timezone", "UTC"))
    except (KeyError, ValueError) as exc:
        raise RuleValidationError(f"invalid timezone: {trigger.get('timezone')!r}") from exc


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
    _validate_trigger(trigger)
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
        _validate_trigger(trigger)
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

# Metric-triggered rules only, keyed by the signals their condition reads.
# schedule/manual rules are deliberately NOT here — otherwise a scheduled rule
# whose condition names a live metric would also fire on the metric hot path.
_rule_cache: dict[SignalKey, list[Rule]] = {}
# Every enabled rule by id — for the out-of-band (schedule/manual) run path,
# which targets one rule and can't reach it through the signal-keyed cache.
_rules_by_id: dict[uuid.UUID, Rule] = {}
# Enabled rules with trigger.type == "schedule" — iterated by schedule_loop.
_scheduled_rules: list[Rule] = []
_rule_states: dict[uuid.UUID, RuleState] = {}


class _RuleHealthTrack(NamedTuple):
    evaluatable: bool
    last_alert_at: datetime | None


# Per-rule "can it currently evaluate" tracking for the rule_health realtime
# event (Phase 5, app.worker's rules_maintenance_loop). Worker-only, in-memory,
# lost on restart — the first tick after a restart just re-establishes the
# baseline (no transition, no alert).
_rule_health_tracks: dict[uuid.UUID, _RuleHealthTrack] = {}
_RULE_HEALTH_RENOTIFY_AFTER = timedelta(hours=1)

# Deferred (webhook/email) delivery tasks — strong refs so asyncio can't GC a
# task mid-flight; the semaphore bounds concurrency during an endpoint outage.
_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()
_DEFERRED_SEMAPHORE = asyncio.Semaphore(100)

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
    new_by_id: dict[uuid.UUID, Rule] = {}
    new_scheduled: list[Rule] = []
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
        new_by_id[rule.id] = rule
        trigger_type = (rule.trigger or {}).get("type", "metric")
        if trigger_type == "schedule":
            new_scheduled.append(rule)
        elif trigger_type != "manual":  # metric (or an unknown/legacy shape)
            for signal in referenced_signals(rule.condition):
                new_cache.setdefault(signal, []).append(rule)
    _rule_cache.clear()
    _rule_cache.update(new_cache)
    _rules_by_id.clear()
    _rules_by_id.update(new_by_id)
    _scheduled_rules[:] = new_scheduled
    log.info("rule cache reloaded: %d active (%d scheduled)", len(rows), len(new_scheduled))


def scheduled_rules_snapshot() -> list[Rule]:
    """A copy for app.worker's schedule_loop to iterate without racing a reload."""
    return list(_scheduled_rules)


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
                metric,
                value,
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


class _ActionOutcome(NamedTuple):
    """One inline action's dispatch result — actuator_command, the unconditional
    notification row, an unknown action type, or a webhook/email that couldn't
    be deferred (executor saturated). Collected in-memory during
    _dispatch_actions and written to `action_executions` by _record_rule_execution."""

    action_type: str
    action_index: int | None
    status: str  # "success" | "failed"
    detail: dict[str, Any] | None
    command_id: uuid.UUID | None


class _DeferredAction(NamedTuple):
    """A webhook or email action to run in a background task after the
    execution record commits — so a slow/failing endpoint can't stall the
    hot path, and can be retried with backoff."""

    kind: str  # "webhook" | "email"
    action_index: int | None
    config: dict[str, Any]


# Truncate any captured string field (URL, error message) before it lands in
# action_executions.detail — cheap insurance against JSONB bloat on this
# single-host deployment (CLAUDE.md §1).
_DETAIL_STRING_MAX = 500


async def _dispatch_actions(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    tenant_slug: str,
    device_slug: str,
    metric: str | None,
    value: float | None,
    timestamp: datetime,
    snapshot: MetricSnapshot,
    rule: Rule,
    *,
    trigger_source: str = "metric",
) -> None:
    """Dispatch every configured action.

    Actuator commands run INLINE, in today's order (the MQTT publish inside
    dispatch_command happens before any bookkeeping — CLAUDE.md §9 constraint
    1's <2s budget). Webhook/email actions are collected as descriptors and
    handed to background tasks AFTER the execution record commits — one slow
    or failing endpoint can no longer stall telemetry ingestion for every
    device, and each gets bounded exponential-backoff retry.
    """
    trigger_device_id = device_id
    outcomes: list[_ActionOutcome] = []
    deferred: list[_DeferredAction] = []

    for action_index, action in enumerate(rule.actions):
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
                    outcomes.append(
                        _ActionOutcome(
                            "actuator_command",
                            action_index,
                            "failed",
                            {"reason": "target_unresolvable", "device_id": action.get("device_id")},
                            None,
                        )
                    )
                    continue
                target_id, target_tenant_slug, target_device_slug = target
                command_id = uuid.uuid4()
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
                    command_id=command_id,
                )
                outcomes.append(
                    _ActionOutcome(
                        "actuator_command",
                        action_index,
                        "success",
                        {
                            "actuator": action["actuator"],
                            "value": action["value"],
                            "device_id": str(target_id),
                        },
                        command_id,
                    )
                )
            elif action_type == "webhook":
                deferred.append(_DeferredAction("webhook", action_index, dict(action)))
            elif action_type != "notification":
                log.warning("unknown action type %r for rule %s", action_type, rule.id)
                outcomes.append(
                    _ActionOutcome(
                        "unknown", action_index, "failed", {"action_type": action_type}, None
                    )
                )
            # "notification"-type actions stay a no-op here — the platform row
            # is written unconditionally below; the "email" channel (if any) is
            # queued as a deferred action there.
        except Exception as exc:
            log.exception("action %r failed for rule %s", action_type, rule.id)
            outcomes.append(
                _ActionOutcome(
                    action_type or "unknown",
                    action_index,
                    "failed",
                    {"error": str(exc)[:_DETAIL_STRING_MAX]},
                    None,
                )
            )

    # A platform notification row is written for every firing regardless of the
    # rule's configured actions — this is what answers "did anything cross a
    # threshold". A `notification`-type action supplies its own message and may
    # add the "email" channel; otherwise one message is auto-generated.
    notif_index, notif = next(
        ((i, a) for i, a in enumerate(rule.actions) if a.get("type") == "notification"),
        (None, None),
    )
    message = notif["message"] if notif is not None else _default_message(rule, snapshot)
    try:
        await notifications_service.create_notification(
            factory, tenant_id, trigger_device_id, rule.id, message
        )
        outcomes.append(
            _ActionOutcome("notification", notif_index, "success", {"message": message}, None)
        )
    except Exception as exc:
        log.exception("notification write failed for rule %s", rule.id)
        outcomes.append(
            _ActionOutcome(
                "notification",
                notif_index,
                "failed",
                {"message": message, "error": str(exc)[:_DETAIL_STRING_MAX]},
                None,
            )
        )
    if notif is not None and "email" in (notif.get("channels") or ["platform"]):
        deferred.append(
            _DeferredAction("email", notif_index, {"message": message, "rule_name": rule.name})
        )

    # When the executor is saturated (a webhook/email outage backing everything
    # up), record the deferred actions as failed inline rather than piling up
    # unbounded background tasks.
    to_spawn: list[_DeferredAction] = []
    for descriptor in deferred:
        if _DEFERRED_SEMAPHORE.locked():
            outcomes.append(
                _ActionOutcome(
                    descriptor.kind,
                    descriptor.action_index,
                    "failed",
                    {"reason": "executor_saturated"},
                    None,
                )
            )
        else:
            to_spawn.append(descriptor)

    # Own defensive try/except, separate from every one above — a history-write
    # failure must never be conflated with, or able to break, actual dispatch.
    execution_id: uuid.UUID | None = None
    try:
        execution_id = await _record_rule_execution(
            factory,
            tenant_id,
            rule,
            trigger_device_id,
            metric,
            value,
            timestamp,
            snapshot,
            outcomes,
            trigger_source,
        )
    except Exception:
        log.exception("execution history write failed for rule %s", rule.id)

    # Spawn the deferred deliveries only after the parent rule_executions row
    # has committed — each task INSERTs an action_executions row FK'd to it.
    if execution_id is not None:
        for descriptor in to_spawn:
            _spawn_deferred(
                _run_deferred_action(
                    factory, tenant_id, rule.id, rule.name, execution_id, descriptor
                )
            )


async def _record_rule_execution(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    rule: Rule,
    trigger_device_id: uuid.UUID | None,
    metric: str | None,
    value: float | None,
    fired_at: datetime,
    snapshot: MetricSnapshot,
    outcomes: list[_ActionOutcome],
    trigger_source: str,
) -> uuid.UUID:
    """Writes the rule_executions row + the inline action_executions rows in
    one transaction. Returns the execution id so _dispatch_actions can FK the
    deferred (webhook/email) action rows to it."""
    summary = _default_message(rule, snapshot)
    execution_id = uuid.uuid4()
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        session.add(
            RuleExecution(
                id=execution_id,
                tenant_id=tenant_id,
                rule_id=rule.id,
                device_id=trigger_device_id,
                metric=metric,
                value=value,
                trigger_source=trigger_source,
                fired_at=fired_at,
                summary=summary,
            )
        )
        await session.flush()
        session.add_all(
            [
                ActionExecution(
                    tenant_id=tenant_id,
                    rule_execution_id=execution_id,
                    action_type=o.action_type,
                    action_index=o.action_index,
                    status=o.status,
                    detail=o.detail,
                    command_id=o.command_id,
                )
                for o in outcomes
            ]
        )
    await realtime_service.publish_event(
        tenant_id, {"type": "rule_execution", "rule_id": str(rule.id), "id": str(execution_id)}
    )
    return execution_id


# ---- Deferred action delivery (webhook / email, off the hot path) -----------


def _spawn_deferred(coro: Coroutine[Any, Any, None]) -> None:
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


async def _resolve_email_recipients(
    factory: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID
) -> list[str]:
    """The tenant's explicit notification_emails, or (if unset) the emails of
    every owner/admin member. Composed here rather than in tenants/service.py —
    that module can't import auth/service (circular)."""
    async with factory() as session:
        await set_tenant_context(session, tenant_id)
        tenant = await tenants_service.get_tenant(session, tenant_id)
        if tenant.notification_emails:
            return [str(e) for e in tenant.notification_emails]
        member_ids = await tenants_service.list_member_ids_by_roles(
            session, tenant_id, {"owner", "admin"}
        )
        emails = await auth_service.get_emails_by_user_ids(session, member_ids)
    return list(emails.values())


async def _write_deferred_result(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    execution_id: uuid.UUID,
    descriptor: _DeferredAction,
    status: str,
    detail: dict[str, Any],
) -> None:
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        session.add(
            ActionExecution(
                tenant_id=tenant_id,
                rule_execution_id=execution_id,
                action_type=descriptor.kind,
                action_index=descriptor.action_index,
                status=status,
                detail=detail,
                command_id=None,
            )
        )
    await realtime_service.publish_event(
        tenant_id, {"type": "rule_execution", "rule_id": str(rule_id), "id": str(execution_id)}
    )


async def _run_deferred_action(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    rule_name: str,
    execution_id: uuid.UUID,
    descriptor: _DeferredAction,
) -> None:
    """Background task: run a webhook/email with bounded retry, then append its
    terminal action_executions row. Its own defensive try/except — a failure
    here must never surface as an unhandled task exception.

    Known gap (Phase 7 fixes it with a Redis-Streams dispatcher + DLQ): a
    worker restart mid-retry loses the task, so no row is ever written for
    that delivery.
    """
    try:
        async with _DEFERRED_SEMAPHORE:
            ctx = executors.ActionContext(tenant_id=tenant_id, rule_id=rule_id, rule_name=rule_name)
            if descriptor.kind == "email":
                recipients = await _resolve_email_recipients(factory, tenant_id)
                if not recipients:
                    await _write_deferred_result(
                        factory,
                        tenant_id,
                        rule_id,
                        execution_id,
                        descriptor,
                        "failed",
                        {"reason": "no_recipients"},
                    )
                    return
                config: dict[str, Any] = {
                    "to": recipients,
                    "subject": f"[{rule_name}] alert",
                    "body": descriptor.config["message"],
                }
            else:  # webhook
                config = descriptor.config
            result = await executors.execute_with_retry(descriptor.kind, config, ctx)
            await _write_deferred_result(
                factory,
                tenant_id,
                rule_id,
                execution_id,
                descriptor,
                result.status,
                result.detail,
            )
    except Exception:
        log.exception("deferred %s action failed for rule %s", descriptor.kind, rule_id)


class ActionExecutionRow(NamedTuple):
    id: uuid.UUID
    action_type: str
    action_index: int | None
    status: str
    detail: dict[str, Any] | None
    command_id: uuid.UUID | None
    created_at: datetime


class RuleExecutionRow(NamedTuple):
    id: uuid.UUID
    rule_id: uuid.UUID | None
    device_id: uuid.UUID | None
    device_name: str | None
    metric: str | None
    value: float | None
    trigger_source: str
    fired_at: datetime
    summary: str
    created_at: datetime
    actions: list[ActionExecutionRow]


async def list_rule_executions(
    session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID, limit: int = 100
) -> list[RuleExecutionRow]:
    """Flat capped list, newest first — matches this codebase's only existing
    pagination convention (commands/notifications' hardcoded .limit(N), no
    offset/cursor anywhere). Device display name resolved via a raw text()
    join, same reason list_rule_device_rows does — rules/ never imports
    devices/models.py directly (CLAUDE.md §6).
    """
    result = await session.execute(
        select(RuleExecution)
        .where(RuleExecution.tenant_id == tenant_id, RuleExecution.rule_id == rule_id)
        .order_by(RuleExecution.fired_at.desc())
        .limit(limit)
    )
    executions = list(result.scalars().all())
    if not executions:
        return []

    device_ids = {e.device_id for e in executions if e.device_id is not None}
    device_names: dict[uuid.UUID, str] = {}
    if device_ids:
        device_rows = await session.execute(
            text("SELECT id, name FROM devices WHERE tenant_id = :tenant_id AND id = ANY(:ids)"),
            {"tenant_id": tenant_id, "ids": [str(d) for d in device_ids]},
        )
        device_names = {row["id"]: row["name"] for row in device_rows.mappings().all()}

    execution_ids = [e.id for e in executions]
    action_result = await session.execute(
        select(ActionExecution).where(ActionExecution.rule_execution_id.in_(execution_ids))
    )
    actions_by_execution: dict[uuid.UUID, list[ActionExecutionRow]] = {}
    for a in action_result.scalars().all():
        actions_by_execution.setdefault(a.rule_execution_id, []).append(
            ActionExecutionRow(
                id=a.id,
                action_type=a.action_type,
                action_index=a.action_index,
                status=a.status,
                detail=a.detail,
                command_id=a.command_id,
                created_at=a.created_at,
            )
        )

    return [
        RuleExecutionRow(
            id=e.id,
            rule_id=e.rule_id,
            device_id=e.device_id,
            device_name=device_names.get(e.device_id) if e.device_id is not None else None,
            metric=e.metric,
            value=e.value,
            trigger_source=e.trigger_source,
            fired_at=e.fired_at,
            summary=e.summary,
            created_at=e.created_at,
            actions=actions_by_execution.get(e.id, []),
        )
        for e in executions
    ]


class FailedActionRow(NamedTuple):
    id: uuid.UUID
    rule_id: uuid.UUID | None
    rule_name: str | None
    action_type: str
    action_index: int | None
    detail: dict[str, Any] | None
    summary: str
    fired_at: datetime
    created_at: datetime


async def list_failed_actions(
    session: AsyncSession, tenant_id: uuid.UUID, limit: int = 100
) -> list[FailedActionRow]:
    """Tenant-wide feed of failed deliveries (webhook/email that exhausted
    retries, unresolvable actuator targets, etc.) — the operational "what is
    broken right now" view. Uses ix_action_executions_failed. Rule name via a
    raw text() join, same no-cross-module-import discipline as elsewhere here.
    """
    result = await session.execute(
        text(
            "SELECT ae.id, re.rule_id, r.name AS rule_name, ae.action_type, ae.action_index, "
            "ae.detail, re.summary, re.fired_at, ae.created_at "
            "FROM action_executions ae "
            "JOIN rule_executions re ON re.id = ae.rule_execution_id "
            "LEFT JOIN rules r ON r.id = re.rule_id "
            "WHERE ae.tenant_id = :tenant_id AND ae.status = 'failed' "
            "ORDER BY ae.created_at DESC LIMIT :limit"
        ),
        {"tenant_id": tenant_id, "limit": limit},
    )
    return [FailedActionRow(**row) for row in result.mappings().all()]


# ---- Out-of-band runs: manual "Run now" + scheduled triggers ----------------


async def request_manual_run(
    session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID
) -> None:
    """Publish a one-shot run request for app.worker's manual_command_loop.
    No DB write, so — like commands.service.request_manual_command — no
    add_post_commit_callback is needed (nothing to race against a commit)."""
    await redis_client.publish(
        RULES_MANUAL_CHANNEL,
        json.dumps(
            {"tenant_id": str(tenant_id), "rule_id": str(rule_id), "trigger_source": "manual"}
        ),
    )


def schedule_due(rule: Rule, now: datetime) -> bool:
    """Whether `rule`'s cron matches `now` (a UTC datetime the caller has
    truncated to the minute). Evaluated in the rule's own timezone. Returns
    False, never raises, on a malformed cron/timezone (validated at write
    time, but a hand-edited DB row could still be bad)."""
    trigger = rule.trigger or {}
    try:
        tz = ZoneInfo(trigger.get("timezone", "UTC"))
        return bool(croniter.match(trigger["cron"], now.astimezone(tz)))
    except (CroniterError, ValueError, KeyError) as exc:
        log.warning("bad schedule trigger on rule %s: %s", rule.id, exc)
        return False


async def _resolve_rule_context(
    factory: async_sessionmaker[AsyncSession], rule: Rule
) -> tuple[uuid.UUID, str, str] | None:
    """The rule's primary input device as (device_id, tenant_slug,
    device_slug), for an out-of-band run that needs to dispatch an actuator.
    None if that device is gone or disabled."""
    device_id = next(
        (
            leaf.get("device_id")
            for leaf in _condition_leaves(rule.condition)
            if leaf.get("device_id")
        ),
        None,
    )
    if device_id is None:
        return None
    async with factory() as session:
        result = await session.execute(
            text(
                "SELECT device_id, tenant_id, tenant_slug, device_slug, status "
                "FROM lookup_rule_dispatch_targets(:ids)"
            ),
            {"ids": [str(device_id)]},
        )
        row = result.mappings().first()
    if row is None or row["tenant_id"] != rule.tenant_id or row["status"] != "active":
        return None
    return row["device_id"], row["tenant_slug"], row["device_slug"]


async def run_rule_out_of_band(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    trigger_source: str,
) -> None:
    """Evaluate one rule outside the metric hot path (manual "Run now" or a
    schedule tick) and dispatch its actions if the condition is currently met.

    - `manual` bypasses for_duration / cooldown / armed (evaluate_condition) —
      a "test it now" action, same trust tier as a manual actuator toggle.
    - `schedule` keeps the full ThresholdEvaluator (flapping protection must
      not be bypassable on an automated path — CLAUDE.md §9 constraint 7).
    """
    rule = _rules_by_id.get(rule_id)
    if rule is None or rule.tenant_id != tenant_id:
        log.warning("out-of-band run for unknown/mismatched rule %s", rule_id)
        return

    now = datetime.now(UTC)
    snapshot = _snapshot_for_signals(referenced_signals(rule.condition))

    if trigger_source == "manual":
        fired = evaluate_condition(rule.condition, snapshot, now)
    else:
        state = _rule_states.setdefault(rule.id, RuleState())
        fired = _THRESHOLD_EVALUATOR.evaluate(rule, snapshot, now, state) is not None
    if not fired:
        return

    ctx = await _resolve_rule_context(factory, rule)
    if ctx is None:
        log.warning("out-of-band run: no usable device for rule %s", rule_id)
        return
    device_id, tenant_slug, device_slug = ctx
    try:
        await _dispatch_actions(
            client,
            factory,
            tenant_id,
            device_id,
            tenant_slug,
            device_slug,
            None,
            None,
            now,
            snapshot,
            rule,
            trigger_source=trigger_source,
        )
    except Exception:
        log.exception("out-of-band dispatch failed for rule %s", rule_id)


# ---- Rule health (API-side, from the device_metric_health projection) ------


def _max_age_for(catalog_metrics: Any, metric: str) -> int:
    """The staleness bound for one metric, read out of its device-catalog
    entry's `metrics` JSONB array. Fallback if the metric isn't in the catalog."""
    for entry in catalog_metrics or []:
        if isinstance(entry, dict) and entry.get("key") == metric:
            return derive_max_age(
                entry.get("publish", "periodic"), entry.get("publish_interval_seconds")
            )
    return DEFAULT_STALE_METRIC_AGE_SECONDS


def _signal_health_from_row(row: Any, now: datetime) -> RuleSignalHealth:
    device_id = uuid.UUID(str(row["device_id"]))
    metric = row["metric"]
    if row["device_name"] is None or row["device_status"] != "active":
        return RuleSignalHealth(
            device_id=device_id,
            device_name=row["device_name"],
            metric=metric,
            state="missing",
            last_value=None,
            last_seen_at=None,
            max_age_seconds=DEFAULT_STALE_METRIC_AGE_SECONDS,
        )
    max_age = _max_age_for(row["catalog_metrics"], metric)
    last_seen_at: datetime | None = row["last_seen_at"]
    if last_seen_at is None:
        state: Literal["fresh", "stale", "missing"] = "missing"
    elif (now - last_seen_at).total_seconds() > max_age:
        state = "stale"
    else:
        state = "fresh"
    return RuleSignalHealth(
        device_id=device_id,
        device_name=row["device_name"],
        metric=metric,
        state=state,
        last_value=row["last_value"],
        last_seen_at=last_seen_at,
        max_age_seconds=max_age,
    )


async def compute_rule_health(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    rules: list[Rule],
    *,
    now: datetime | None = None,
) -> dict[uuid.UUID, RuleHealth]:
    """For each rule, the freshness of every (device, metric) its condition
    reads — so the UI can show "can't currently evaluate" instead of a rule
    silently failing its leaves closed. One batched query over the distinct
    signal set; tenant-scoped by RLS on devices / device_metric_health.
    """
    now = now or datetime.now(UTC)
    signals_by_rule: dict[uuid.UUID, list[SignalKey]] = {
        rule.id: sorted(referenced_signals(rule.condition)) for rule in rules
    }
    distinct = sorted({s for sigs in signals_by_rule.values() for s in sigs})
    by_signal: dict[SignalKey, RuleSignalHealth] = {}
    if distinct:
        result = await session.execute(
            text(
                "SELECT sig.device_id, sig.metric, d.name AS device_name, "
                "       d.status AS device_status, c.metrics AS catalog_metrics, "
                "       dmh.last_value, dmh.last_seen_at "
                "FROM unnest(CAST(:device_ids AS uuid[]), CAST(:metrics AS text[])) "
                "         AS sig(device_id, metric) "
                "LEFT JOIN devices d ON d.id = sig.device_id AND d.tenant_id = :tenant_id "
                "LEFT JOIN device_catalog_entries c ON c.id = d.catalog_entry_id "
                "LEFT JOIN device_metric_health dmh "
                "       ON dmh.device_id = sig.device_id AND dmh.metric = sig.metric"
            ),
            {
                "device_ids": [s.device_id for s in distinct],
                "metrics": [s.metric for s in distinct],
                "tenant_id": str(tenant_id),
            },
        )
        for row in result.mappings():
            key = SignalKey(str(row["device_id"]), row["metric"])
            by_signal[key] = _signal_health_from_row(row, now)

    out: dict[uuid.UUID, RuleHealth] = {}
    for rule in rules:
        sigs = [
            by_signal.get(
                s,
                RuleSignalHealth(
                    device_id=uuid.UUID(s.device_id),
                    device_name=None,
                    metric=s.metric,
                    state="missing",
                    last_value=None,
                    last_seen_at=None,
                    max_age_seconds=DEFAULT_STALE_METRIC_AGE_SECONDS,
                ),
            )
            for s in signals_by_rule[rule.id]
        ]
        out[rule.id] = RuleHealth(evaluatable=all(s.state == "fresh" for s in sigs), signals=sigs)
    return out


# ---- Simulate / dry-run ---------------------------------------------------


def _action_summary(action: dict[str, Any]) -> str:
    kind = action.get("type")
    if kind == "actuator_command":
        value = action.get("value")
        shown = "ON" if value is True else "OFF" if value is False else value
        return f"Set {action.get('actuator', '?')} to {shown}"
    if kind == "notification":
        channels = action.get("channels") or ["platform"]
        return f"Send a {'/'.join(channels)} notification: {action.get('message', '')}".strip()
    if kind == "webhook":
        return f"POST {action.get('url', '?')}"
    return f"Run {kind or 'unknown'} action"


def _action_previews(rule: Rule) -> list[SimulateActionPreview]:
    return [
        SimulateActionPreview(
            index=i, type=str(action.get("type", "unknown")), summary=_action_summary(action)
        )
        for i, action in enumerate(rule.actions)
    ]


async def simulate_rule(
    session: AsyncSession, tenant_id: uuid.UUID, rule: Rule, req: SimulateRequest
) -> SimulateResponse:
    """Evaluate `rule` against current values (or `req.overrides`, or a
    `req.replay` window over stored telemetry) and report what would happen —
    WITHOUT dispatching anything or writing a single row. Read-only: no
    session.begin(), no _record_rule_execution, no publish_event.
    """
    now = datetime.now(UTC)
    health = (await compute_rule_health(session, tenant_id, [rule], now=now))[rule.id]

    if req.replay is not None:
        replay = await _simulate_replay(session, rule, req.replay, health)
        return SimulateResponse(
            mode="replay",
            evaluated_at=now,
            would_fire=bool(replay.would_have_fired_at),
            condition=None,
            unavailable_signals=[],
            actions=_action_previews(rule),
            replay=replay,
        )

    overrides = {(str(o.device_id), o.metric): o.value for o in req.overrides}
    snapshot: MetricSnapshot = {}
    unavailable: list[RuleSignalHealth] = []
    for sig in health.signals:
        key = SignalKey(str(sig.device_id), sig.metric)
        override = overrides.get((str(sig.device_id), sig.metric))
        if override is not None:
            snapshot[key] = MetricValue(
                value=override, timestamp=now, max_age_seconds=sig.max_age_seconds
            )
        elif sig.state == "fresh" and sig.last_value is not None and sig.last_seen_at is not None:
            snapshot[key] = MetricValue(
                value=sig.last_value,
                timestamp=sig.last_seen_at,
                max_age_seconds=sig.max_age_seconds,
            )
        else:
            unavailable.append(sig)

    tree = explain_condition(rule.condition, snapshot, now)
    return SimulateResponse(
        mode="live",
        evaluated_at=now,
        would_fire=bool(tree["result"]),
        condition=tree,
        unavailable_signals=unavailable,
        actions=_action_previews(rule),
        replay=None,
    )


async def _simulate_replay(
    session: AsyncSession,
    rule: Rule,
    window: SimulateReplayWindow,
    health: RuleHealth,
) -> SimulateReplayResult:
    if window.to <= window.from_:
        raise RuleValidationError("replay window 'to' must be after 'from'")
    span = window.to - window.from_
    if span > timedelta(days=settings.simulate_replay_max_days):
        raise RuleValidationError(
            f"replay window must be {settings.simulate_replay_max_days} days or less"
        )
    resolution: Literal["raw", "1m"] = "raw" if span <= timedelta(hours=6) else "1m"

    max_ages = {SignalKey(str(s.device_id), s.metric): s.max_age_seconds for s in health.signals}
    events: list[tuple[datetime, SignalKey, float]] = []
    for sig in max_ages:
        data = await telemetry_service.get_range(
            session,
            rule.tenant_id,
            uuid.UUID(sig.device_id),
            sig.metric,
            window.from_,
            window.to,
            resolution,
        )
        events.extend((point.time, sig, point.value) for point in data.points)
    events.sort(key=lambda event: event[0])
    truncated = len(events) > settings.simulate_replay_max_samples
    events = events[: settings.simulate_replay_max_samples]

    snapshot: MetricSnapshot = {}
    state = RuleState()
    fired_at: list[datetime] = []
    for timestamp, signal, value in events:
        snapshot[signal] = MetricValue(
            value=value,
            timestamp=timestamp,
            max_age_seconds=max_ages.get(signal, DEFAULT_STALE_METRIC_AGE_SECONDS),
        )
        if _THRESHOLD_EVALUATOR.evaluate(rule, snapshot, timestamp, state) is not None:
            fired_at.append(timestamp)

    return SimulateReplayResult(
        resolution=resolution,
        samples=len(events),
        would_have_fired_at=fired_at,
        truncated=truncated,
    )


# ---- State durability: periodic Redis checkpoint of _rule_states ----------


async def snapshot_rule_states() -> None:
    """Write the current _rule_states to Redis so armed / cooldown /
    for_duration / hysteresis-latch progress survives a normal worker restart.
    Called on a timer by app.worker's rules_maintenance_loop and once more on
    graceful shutdown. Best-effort — a Redis error is logged, not raised."""
    payload = {str(rule_id): rule_state_to_dict(state) for rule_id, state in _rule_states.items()}
    try:
        await redis_client.set(RULE_STATE_REDIS_KEY, json.dumps(payload))
    except redis.RedisError:
        log.warning("rule state checkpoint write failed", exc_info=True)


async def restore_rule_states() -> None:
    """Load the checkpoint into _rule_states at worker startup — call AFTER
    load_rule_cache so _rules_by_id is populated and states for rules deleted
    while the worker was down are dropped."""
    try:
        raw = await redis_client.get(RULE_STATE_REDIS_KEY)
    except redis.RedisError:
        log.warning("rule state checkpoint read failed", exc_info=True)
        return
    if not raw:
        return
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        log.warning("rule state checkpoint is not valid JSON; ignoring")
        return

    restored = 0
    for rule_id_str, blob in (data or {}).items():
        try:
            rule_id = uuid.UUID(rule_id_str)
        except ValueError:
            continue
        if rule_id not in _rules_by_id:
            continue
        _rule_states[rule_id] = rule_state_from_dict(blob)
        restored += 1
    log.info("restored %d rule states from checkpoint", restored)


# ---- Rule health monitoring: the rule_health realtime event --------------


def _rule_evaluatable_now(rule: Rule, now: datetime) -> tuple[bool, list[SignalKey]]:
    """Worker-side "can this rule evaluate right now" — reads the same
    _signal_value_cache the hot-path evaluator sees. Returns
    (all_signals_fresh, the stale/missing ones)."""
    bad: list[SignalKey] = []
    for signal in referenced_signals(rule.condition):
        metric_value = _signal_value_cache.get(signal)
        if (
            metric_value is None
            or (now - metric_value.timestamp).total_seconds() > metric_value.max_age_seconds
        ):
            bad.append(signal)
    return (not bad, sorted(bad))


def _bad_signal_phrase(bad: list[SignalKey]) -> str:
    metrics = sorted({signal.metric for signal in bad})
    verb = "is" if len(metrics) == 1 else "are"
    return f"{', '.join(metrics)} {verb} stale or not reporting"


async def emit_rule_health_transitions(factory: async_sessionmaker[AsyncSession]) -> None:
    """One pass over every enabled non-manual rule: when its "can evaluate"
    state flips, publish a rule_health realtime event; on the flip to
    un-evaluatable, also write one platform notification (debounced per rule).
    The first pass after a worker restart only records the baseline — no
    event, no alert — so a cold _signal_value_cache never cries wolf."""
    now = datetime.now(UTC)
    live_ids: set[uuid.UUID] = set()
    for rule in list(_rules_by_id.values()):
        if (rule.trigger or {}).get("type") == "manual":
            continue
        live_ids.add(rule.id)
        evaluatable, bad = _rule_evaluatable_now(rule, now)
        prev = _rule_health_tracks.get(rule.id)
        if prev is None:
            _rule_health_tracks[rule.id] = _RuleHealthTrack(evaluatable, None)
            continue
        if evaluatable == prev.evaluatable:
            continue

        await realtime_service.publish_event(
            rule.tenant_id,
            {"type": "rule_health", "rule_id": str(rule.id), "evaluatable": evaluatable},
        )
        alert_at = prev.last_alert_at
        if not evaluatable and (
            prev.last_alert_at is None or now - prev.last_alert_at > _RULE_HEALTH_RENOTIFY_AFTER
        ):
            await notifications_service.create_notification(
                factory,
                rule.tenant_id,
                None,
                rule.id,
                f'Rule "{rule.name}" can\'t evaluate right now: {_bad_signal_phrase(bad)}.',
            )
            alert_at = now
        _rule_health_tracks[rule.id] = _RuleHealthTrack(evaluatable, alert_at)

    for gone in set(_rule_health_tracks) - live_ids:
        del _rule_health_tracks[gone]
