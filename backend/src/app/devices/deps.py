"""Dependency-injection providers for device routes."""

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices import service
from app.devices.models import Device
from app.tenants.deps import TenantContext, require_tenant_context


async def get_device_or_404(
    device_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> Device:
    try:
        return await service.get_device(session, ctx.tenant_id, device_id)
    except service.DeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        ) from exc
