"""Dependency-injection providers for rule routes."""

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.rules import service
from app.rules.models import Rule
from app.tenants.deps import TenantContext, require_tenant_context


async def get_rule_or_404(
    rule_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> Rule:
    try:
        return await service.get_rule(session, ctx.tenant_id, rule_id)
    except service.RuleNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found") from exc
