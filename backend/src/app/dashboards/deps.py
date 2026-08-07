"""Dependency-injection providers for dashboard routes."""

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.dashboards import service
from app.dashboards.models import Dashboard
from app.db import get_session
from app.tenants.deps import TenantContext, require_tenant_context


async def get_dashboard_or_404(
    dashboard_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Dashboard:
    try:
        return await service.get_dashboard(session, ctx.tenant_id, current_user.id, dashboard_id)
    except service.DashboardNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        ) from exc
