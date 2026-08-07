"""Rule routes: CRUD for threshold rules.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in rules/service.py.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.rules import service
from app.rules.deps import get_rule_or_404
from app.rules.models import Rule
from app.rules.schemas import (
    RuleCreateRequest,
    RuleResponse,
    RuleUpdateRequest,
    RuleWithDeviceResponse,
)
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(tags=["rules"])


def _to_response(rule: Rule) -> RuleResponse:
    return RuleResponse(
        id=rule.id,
        device_id=rule.device_id,
        metric=rule.metric,
        type=rule.type,
        operator=rule.operator,
        threshold=rule.threshold,
        for_duration=rule.for_duration,
        hysteresis=rule.hysteresis,
        action=rule.action,
        cooldown=rule.cooldown,
        enabled=rule.enabled,
        created_at=rule.created_at,
    )


@router.get("/devices/{device_id}/rules", response_model=list[RuleResponse])
async def list_rules(
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session),
) -> list[RuleResponse]:
    rules = await service.list_rules(session, device.tenant_id, device.id)
    return [_to_response(r) for r in rules]


@router.get("/rules", response_model=list[RuleWithDeviceResponse])
async def list_all_rules(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[RuleWithDeviceResponse]:
    rows = await service.list_all_rules(session, ctx.tenant_id)
    return [RuleWithDeviceResponse(**row._asdict()) for row in rows]


@router.post(
    "/devices/{device_id}/rules", response_model=RuleResponse, status_code=status.HTTP_201_CREATED
)
async def create_rule(
    body: RuleCreateRequest,
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    rule = await service.create_rule(
        session,
        ctx.tenant_id,
        device.id,
        body.metric,
        body.operator,
        body.threshold,
        body.for_duration,
        body.hysteresis,
        body.cooldown,
        body.action.model_dump(),
        body.enabled,
    )
    return _to_response(rule)


@router.get("/rules/{rule_id}", response_model=RuleResponse)
async def get_rule(rule: Rule = Depends(get_rule_or_404)) -> RuleResponse:
    return _to_response(rule)


@router.patch("/rules/{rule_id}", response_model=RuleResponse)
async def update_rule(
    body: RuleUpdateRequest,
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> RuleResponse:
    updated = await service.update_rule(
        session,
        ctx.tenant_id,
        rule.id,
        body.metric,
        body.operator,
        body.threshold,
        body.for_duration,
        body.hysteresis,
        body.cooldown,
        body.action.model_dump() if body.action is not None else None,
        body.enabled,
    )
    return _to_response(updated)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule: Rule = Depends(get_rule_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_rule(session, ctx.tenant_id, rule.id)
