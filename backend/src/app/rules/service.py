"""Rule CRUD, the worker-side in-memory rule cache (keyed by device_id+metric,
reloaded on Redis pub/sub invalidation — see rule_cache_loop in
app/worker.py), and hot-path evaluation/dispatch.
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
from app.rules.evaluators import Action, Evaluator, Reading, RuleState, ThresholdEvaluator
from app.rules.models import Rule, RuleType

log = logging.getLogger("rules")

RULES_INVALIDATE_CHANNEL = "rules:invalidate"

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


def _default_message(rule: Rule, reading: Reading) -> str:
    op = _OPERATOR_WORDS.get(rule.operator, rule.operator)
    return f"{rule.metric} {op} {rule.threshold} (currently {reading.value}) on this device."


class RuleNotFoundError(Exception):
    pass


# ---- CRUD ------------------------------------------------------------------


async def create_rule(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    metric: str,
    operator: str,
    threshold: float,
    for_duration: int,
    hysteresis: float,
    cooldown: int,
    action: dict[str, Any],
    enabled: bool,
) -> Rule:
    rule = Rule(
        tenant_id=tenant_id,
        device_id=device_id,
        metric=metric,
        type=RuleType.THRESHOLD.value,
        operator=operator,
        threshold=threshold,
        for_duration=for_duration,
        hysteresis=hysteresis,
        cooldown=cooldown,
        action=action,
        enabled=enabled,
    )
    session.add(rule)
    await session.flush()
    _publish_invalidation(session, device_id)
    return rule


async def list_rules(session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID) -> list[Rule]:
    result = await session.execute(
        select(Rule).where(Rule.tenant_id == tenant_id, Rule.device_id == device_id)
    )
    return list(result.scalars().all())


class RuleWithDeviceRow(NamedTuple):
    """One row of the tenant-wide /rules list. A plain tuple, not a `Rule` ORM
    instance, because building it means joining against `devices` — and per
    CLAUDE.md §6, rules/service.py must not import devices/models.py's `Device`
    to do that. A raw `text()` join sidesteps the cross-module model import
    the same way devices.service.lookup_device_by_slug does for its own
    cross-cutting query.
    """

    id: uuid.UUID
    device_id: uuid.UUID
    metric: str
    type: str
    operator: str
    threshold: float
    for_duration: int
    hysteresis: float
    action: dict[str, Any]
    cooldown: int
    enabled: bool
    created_at: datetime
    device_name: str
    device_slug: str


async def list_all_rules(session: AsyncSession, tenant_id: uuid.UUID) -> list[RuleWithDeviceRow]:
    result = await session.execute(
        text(
            "SELECT r.id, r.device_id, r.metric, r.type, r.operator, r.threshold, "
            "r.for_duration, r.hysteresis, r.action, r.cooldown, r.enabled, r.created_at, "
            "d.name AS device_name, d.slug AS device_slug "
            "FROM rules r JOIN devices d ON d.id = r.device_id "
            "WHERE r.tenant_id = :tenant_id ORDER BY d.name, r.created_at"
        ),
        {"tenant_id": tenant_id},
    )
    return [RuleWithDeviceRow(**row) for row in result.mappings().all()]


async def get_rule(session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> Rule:
    result = await session.execute(
        select(Rule).where(Rule.tenant_id == tenant_id, Rule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise RuleNotFoundError
    return rule


async def update_rule(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    rule_id: uuid.UUID,
    metric: str | None,
    operator: str | None,
    threshold: float | None,
    for_duration: int | None,
    hysteresis: float | None,
    cooldown: int | None,
    action: dict[str, Any] | None,
    enabled: bool | None,
) -> Rule:
    rule = await get_rule(session, tenant_id, rule_id)
    if metric is not None:
        rule.metric = metric
    if operator is not None:
        rule.operator = operator
    if threshold is not None:
        rule.threshold = threshold
    if for_duration is not None:
        rule.for_duration = for_duration
    if hysteresis is not None:
        rule.hysteresis = hysteresis
    if cooldown is not None:
        rule.cooldown = cooldown
    if action is not None:
        rule.action = action
    if enabled is not None:
        rule.enabled = enabled
    await session.flush()
    _publish_invalidation(session, rule.device_id)
    return rule


async def delete_rule(session: AsyncSession, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> None:
    rule = await get_rule(session, tenant_id, rule_id)
    device_id = rule.device_id
    await session.delete(rule)
    await session.flush()
    _publish_invalidation(session, device_id)


def _publish_invalidation(session: AsyncSession, device_id: uuid.UUID) -> None:
    """Registers the actual Redis publish to run only after this session's
    transaction commits — see db.add_post_commit_callback's docstring.
    Publishing immediately (mid-transaction) would race the worker's reload
    against a write Postgres hasn't made visible to that other connection
    yet; confirmed live, not hypothetical.
    """

    async def _publish() -> None:
        await redis_client.publish(RULES_INVALIDATE_CHANNEL, str(device_id))

    add_post_commit_callback(session, _publish)


# ---- Worker-side cache + hot path -------------------------------------------

_rule_cache: dict[tuple[uuid.UUID, str], list[Rule]] = {}
_rule_states: dict[uuid.UUID, RuleState] = {}


async def load_rule_cache(factory: async_sessionmaker[AsyncSession]) -> None:
    """Full reload — called once at worker startup and on every
    rules:invalidate pub/sub message. Simple and correct at 500-1000 device
    scale; no need for partial/targeted reload.
    """
    # rules has RLS, and this reads across every tenant — the same escape
    # hatch as devices.service.lookup_device_for_auth/lookup_device_by_slug
    # (see the add_rule_cache_lookup_function migration).
    async with factory() as session:
        result = await session.execute(text("SELECT * FROM list_enabled_rules()"))
        rows = result.mappings().all()

    new_cache: dict[tuple[uuid.UUID, str], list[Rule]] = {}
    for row in rows:
        rule = Rule(
            id=row["id"],
            tenant_id=row["tenant_id"],
            device_id=row["device_id"],
            metric=row["metric"],
            type=row["type"],
            operator=row["operator"],
            threshold=row["threshold"],
            for_duration=row["for_duration"],
            hysteresis=row["hysteresis"],
            action=row["action"],
            cooldown=row["cooldown"],
            enabled=row["enabled"],
        )
        new_cache.setdefault((rule.device_id, rule.metric), []).append(rule)
    _rule_cache.clear()
    _rule_cache.update(new_cache)
    log.info("rule cache reloaded: %d active rules", len(rows))


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

    Both the evaluator call and the dispatch are wrapped defensively: this
    runs inside the single shared MQTT message loop for every device, so one
    malformed rule or one failed dispatch (a webhook to a dead URL, an MQTT
    publish error) must never stop evaluation for other rules on this
    reading, or ingestion for every other device (CLAUDE.md constraint 11,
    extended to this new hot path).
    """
    rules = _rule_cache.get((device_id, metric))
    if not rules:
        return

    reading = Reading(device_id=device_id, metric=metric, value=value, timestamp=timestamp)
    for rule in rules:
        state = _rule_states.setdefault(rule.id, RuleState())
        try:
            action = _THRESHOLD_EVALUATOR.evaluate(rule, reading, state)
        except Exception:
            log.exception("evaluator raised for rule %s -- treating as no-fire", rule.id)
            continue
        if action is None:
            continue
        try:
            await _dispatch_action(client, factory, tenant_id, tenant_slug, device_slug, reading, action, rule)
        except Exception:
            log.exception("dispatch failed for rule %s", rule.id)


async def _dispatch_action(
    client: aiomqtt.Client,
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    tenant_slug: str,
    device_slug: str,
    reading: Reading,
    action: Action,
    rule: Rule,
) -> None:
    if action.action_type == "actuator_command":
        await commands_service.dispatch_command(
            client,
            factory,
            tenant_id,
            reading.device_id,
            action.rule_id,
            reading.timestamp,
            tenant_slug,
            device_slug,
            actuator=action.payload["actuator"],
            value=action.payload["value"],
        )
    elif action.action_type == "webhook":
        try:
            async with httpx.AsyncClient(timeout=5) as http_client:
                await http_client.post(action.payload["url"], json=action.payload.get("body", {}))
        except httpx.HTTPError as exc:
            log.warning("webhook dispatch failed for rule %s: %s", action.rule_id, exc)
    else:
        log.warning("unknown action type %r for rule %s", action.action_type, action.rule_id)

    # A notification row is written for every firing, regardless of the
    # rule's configured action — this is what answers "did anything cross a
    # threshold" (UX_UI_Description.md), not just rules explicitly configured
    # to notify. `notification`-type actions use their own custom message
    # verbatim; every other action type gets an auto-generated one.
    message = (
        action.payload["message"]
        if action.action_type == "notification"
        else _default_message(rule, reading)
    )
    try:
        await notifications_service.create_notification(
            factory, tenant_id, reading.device_id, action.rule_id, message
        )
    except Exception:
        log.exception("notification write failed for rule %s", action.rule_id)
