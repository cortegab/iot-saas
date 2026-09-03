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
    ConditionNode,
    DeviceRuleCreateRequest,
    ExecutionPolicy,
    RuleCreateRequest,
    RuleDeviceRef,
    RuleResponse,
    RuleUpdateRequest,
)
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(tags=["rules"])

_condition_adapter: TypeAdapter[ConditionNode] = TypeAdapter(ConditionNode)


def _to_response(rule: Rule, device_rows: list[service.RuleDeviceRow]) -> RuleResponse:
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
        action=actions[0] if actions else {},
        for_duration=policy.for_duration,
        cooldown=policy.cooldown,
    )


async def _responses(
    session: AsyncSession, tenant_id: uuid.UUID, rules: list[Rule]
) -> list[RuleResponse]:
    by_rule = await service.list_rule_device_rows(session, tenant_id, [r.id for r in rules])
    return [_to_response(r, by_rule.get(r.id, [])) for r in rules]


async def _response(session: AsyncSession, tenant_id: uuid.UUID, rule: Rule) -> RuleResponse:
    by_rule = await service.list_rule_device_rows(session, tenant_id, [rule.id])
    return _to_response(rule, by_rule.get(rule.id, []))


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


@router.get("/rules/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    return await _response(session, ctx.tenant_id, rule)


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
