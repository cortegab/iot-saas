"""Dependency-injection providers for the zone routes."""

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.tenants.deps import TenantContext, require_tenant_context
from app.zones import service
from app.zones.models import Zone


async def get_zone_or_404(
    zone_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> Zone:
    try:
        return await service.get_zone(session, ctx.tenant_id, zone_id)
    except service.ZoneNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found") from exc
