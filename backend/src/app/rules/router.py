"""Rule routes: CRUD for the multi-device rule engine.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in rules/service.py.

`POST /rules` takes the canonical multi-device definition. `POST
/devices/{device_id}/rules` stays as a backward-compatible wrapper for
single-device rules (the path device is stamped onto every leaf / actuator
action, and the pre-multi-device `action`/`for_duration`/`cooldown` fields
are still accepted).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.rules import service
from app.rules.deps import get_rule_or_404
from app.rules.models import Rule
from app.rules.schemas import (
    ActionExecutionResponse,
    ConditionNode,
    DeviceRuleCreateRequest,
    ExecutionPolicy,
    FailedActionResponse,
    RuleCreateRequest,
    RuleDeviceRef,
    RuleExecutionResponse,
    RuleHealth,
    RuleResponse,
    RuleUpdateRequest,
    SimulateRequest,
    SimulateResponse,
)
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(tags=["rules"])

_condition_adapter: TypeAdapter[ConditionNode] = TypeAdapter(ConditionNode)


def _to_response(
    rule: Rule, device_rows: list[service.RuleDeviceRow], health: RuleHealth
) -> RuleResponse:
    policy = ExecutionPolicy.model_validate(rule.execution_policy)
    actions: list[dict[str, object]] = list(rule.actions)
    return RuleResponse(
        id=rule.id,
        name=rule.name,
        description=rule.description,
        type=rule.type,
        trigger=rule.trigger,
        condition=_condition_adapter.validate_python(rule.condition),
        execution_policy=policy,
        actions=actions,
        devices=[
            RuleDeviceRef(
                device_id=row.device_id,
                role=row.role,  # type: ignore[arg-type]
                device_name=row.device_name,
            )
            for row in device_rows
        ],
        enabled=rule.enabled,
        created_at=rule.created_at,
        health=health,
        action=actions[0] if actions else {},
        for_duration=policy.for_duration,
        cooldown=policy.cooldown,
    )


_NO_SIGNALS_HEALTH = RuleHealth(evaluatable=True, signals=[])


async def _responses(
    session: AsyncSession, tenant_id: uuid.UUID, rules: list[Rule]
) -> list[RuleResponse]:
    by_rule = await service.list_rule_device_rows(session, tenant_id, [r.id for r in rules])
    health = await service.compute_rule_health(session, tenant_id, rules)
    return [
        _to_response(r, by_rule.get(r.id, []), health.get(r.id, _NO_SIGNALS_HEALTH)) for r in rules
    ]


async def _response(session: AsyncSession, tenant_id: uuid.UUID, rule: Rule) -> RuleResponse:
    by_rule = await service.list_rule_device_rows(session, tenant_id, [rule.id])
    health = await service.compute_rule_health(session, tenant_id, [rule])
    return _to_response(rule, by_rule.get(rule.id, []), health.get(rule.id, _NO_SIGNALS_HEALTH))


@router.get("/devices/{device_id}/rules", response_model=list[RuleResponse])
async def list_rules(
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session),
) -> list[RuleResponse]:
    rules = await service.list_rules(session, device.tenant_id, device.id)
    return await _responses(session, device.tenant_id, rules)


@router.get("/rules", response_model=list[RuleResponse])
async def list_all_rules(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[RuleResponse]:
    rules = await service.list_all_rules(session, ctx.tenant_id)
    return await _responses(session, ctx.tenant_id, rules)


@router.post("/rules", response_model=RuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: RuleCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    try:
        rule = await service.create_rule_canonical(
            session,
            ctx.tenant_id,
            name=body.name,
            description=body.description,
            trigger=body.trigger.model_dump(mode="json"),
            condition=body.condition.model_dump(mode="json"),
            execution_policy=body.execution_policy.model_dump(mode="json"),
            actions=[a.model_dump(mode="json") for a in body.actions],
            editor_graph=body.editor_graph,
            enabled=body.enabled,
        )
    except service.RuleValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    return await _response(session, ctx.tenant_id, rule)


@router.post(
    "/devices/{device_id}/rules", response_model=RuleResponse, status_code=status.HTTP_201_CREATED
)
async def create_device_rule(
    body: DeviceRuleCreateRequest,
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    try:
        rule = await service.create_device_rule(
            session,
            ctx.tenant_id,
            device.id,
            name=body.name,
            condition=body.condition.model_dump(mode="json"),
            for_duration=body.for_duration,
            cooldown=body.cooldown,
            action=body.action.model_dump(mode="json") if body.action is not None else None,
            actions=(
                [a.model_dump(mode="json") for a in body.actions]
                if body.actions is not None
                else None
            ),
            enabled=body.enabled,
        )
    except service.RuleValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    return await _response(session, ctx.tenant_id, rule)


@router.get("/rules/failed-actions", response_model=list[FailedActionResponse])
async def list_failed_actions(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[FailedActionResponse]:
    # Declared above GET /rules/{rule_id} so "failed-actions" isn't matched as
    # a rule_id. Read-side feed — membership is enough, no admin gate (same
    # reasoning as notifications/router.py).
    rows = await service.list_failed_actions(session, ctx.tenant_id)
    return [
        FailedActionResponse(
            id=row.id,
            rule_id=row.rule_id,
            rule_name=row.rule_name,
            action_type=row.action_type,
            action_index=row.action_index,
            detail=row.detail,
            summary=row.summary,
            fired_at=row.fired_at,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/rules/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    return await _response(session, ctx.tenant_id, rule)


@router.post("/rules/{rule_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_rule(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Manual "Run now" — publishes a one-shot run request; app.worker
    evaluates the condition against the live signal cache and fires only if
    it's currently met."""
    await service.request_manual_run(session, ctx.tenant_id, rule.id)


@router.post("/rules/{rule_id}/simulate", response_model=SimulateResponse)
async def simulate_rule(
    body: SimulateRequest,
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> SimulateResponse:
    """Dry-run: evaluate the rule against current values (or overrides, or a
    replay window) and report what would happen — writes nothing, dispatches
    nothing. Any member may run it; there are no side effects."""
    try:
        return await service.simulate_rule(session, ctx.tenant_id, rule, body)
    except service.RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rules/{rule_id}/executions", response_model=list[RuleExecutionResponse])
async def list_rule_executions(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[RuleExecutionResponse]:
    rows = await service.list_rule_executions(session, ctx.tenant_id, rule.id)
    return [
        RuleExecutionResponse(
            id=row.id,
            rule_id=row.rule_id,
            device_id=row.device_id,
            device_name=row.device_name,
            metric=row.metric,
            value=row.value,
            trigger_source=row.trigger_source,
            fired_at=row.fired_at,
            summary=row.summary,
            created_at=row.created_at,
            actions=[
                ActionExecutionResponse(
                    id=a.id,
                    action_type=a.action_type,
                    action_index=a.action_index,
                    status=a.status,  # type: ignore[arg-type]
                    detail=a.detail,
                    command_id=a.command_id,
                    created_at=a.created_at,
                )
                for a in row.actions
            ],
        )
        for row in rows
    ]


@router.patch("/rules/{rule_id}", response_model=RuleResponse)
async def update_rule(
    body: RuleUpdateRequest,
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    try:
        updated = await service.update_rule(
            session,
            ctx.tenant_id,
            rule.id,
            name=body.name,
            description=body.description,
            trigger=body.trigger.model_dump(mode="json") if body.trigger is not None else None,
            condition=(
                body.condition.model_dump(mode="json") if body.condition is not None else None
            ),
            execution_policy=(
                body.execution_policy.model_dump(mode="json")
                if body.execution_policy is not None
                else None
            ),
            actions=(
                [a.model_dump(mode="json") for a in body.actions]
                if body.actions is not None
                else None
            ),
            editor_graph=body.editor_graph,
            enabled=body.enabled,
            for_duration=body.for_duration,
            cooldown=body.cooldown,
            action=body.action.model_dump(mode="json") if body.action is not None else None,
        )
    except service.RuleValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    return await _response(session, ctx.tenant_id, updated)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_rule(session, ctx.tenant_id, rule.id)
