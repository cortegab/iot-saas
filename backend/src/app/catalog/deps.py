"""Dependency-injection providers for catalog routes."""

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service
from app.catalog.models import DeviceCatalogEntry
from app.db import get_session
from app.tenants.deps import TenantContext, require_tenant_context


async def get_catalog_entry_or_404(
    entry_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> DeviceCatalogEntry:
    try:
        return await service.get_catalog_entry(session, ctx.tenant_id, entry_id)
    except service.CatalogEntryNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found"
        ) from exc
