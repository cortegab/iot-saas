"""Device catalog routes: CRUD for tenant-defined device types.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in catalog/service.py. Reads are member-accessible (a catalog entry needs to
be visible to pick from at device-creation time, which any member can do);
writes are admin-gated via require_role, the same pattern devices/router.py
uses for device mutations.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service
from app.catalog.deps import get_catalog_entry_or_404
from app.catalog.models import DeviceCatalogEntry
from app.catalog.schemas import (
    CatalogActuator,
    CatalogEntryCreateRequest,
    CatalogEntryResponse,
    CatalogEntryUpdateRequest,
    CatalogMetric,
)
from app.db import get_session
from app.devices import service as devices_service
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(prefix="/catalog", tags=["catalog"])


def _to_response(entry: DeviceCatalogEntry, device_count: int = 0) -> CatalogEntryResponse:
    return CatalogEntryResponse(
        id=entry.id,
        name=entry.name,
        metrics=[CatalogMetric.model_validate(m) for m in entry.metrics],
        actuators=[CatalogActuator.model_validate(a) for a in entry.actuators],
        status=entry.status,  # type: ignore[arg-type]
        is_legacy=entry.is_legacy,
        device_count=device_count,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("", response_model=list[CatalogEntryResponse])
async def list_catalog_entries(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[CatalogEntryResponse]:
    entries = await service.list_catalog_entries(session, ctx.tenant_id)
    counts = await devices_service.count_devices_by_catalog_entry(session, ctx.tenant_id)
    return [_to_response(e, counts.get(e.id, 0)) for e in entries]


@router.post("", response_model=CatalogEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_catalog_entry(
    body: CatalogEntryCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> CatalogEntryResponse:
    entry = await service.create_catalog_entry(
        session,
        ctx.tenant_id,
        body.name,
        [m.model_dump(mode="json") for m in body.metrics],
        [a.model_dump(mode="json") for a in body.actuators],
    )
    return _to_response(entry)


@router.get("/{entry_id}", response_model=CatalogEntryResponse)
async def get_catalog_entry(
    entry: DeviceCatalogEntry = Depends(get_catalog_entry_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> CatalogEntryResponse:
    counts = await devices_service.count_devices_by_catalog_entry(session, ctx.tenant_id)
    return _to_response(entry, counts.get(entry.id, 0))


@router.patch("/{entry_id}", response_model=CatalogEntryResponse)
async def update_catalog_entry(
    body: CatalogEntryUpdateRequest,
    entry: DeviceCatalogEntry = Depends(get_catalog_entry_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> CatalogEntryResponse:
    metrics = [m.model_dump(mode="json") for m in body.metrics] if body.metrics is not None else None
    actuators = (
        [a.model_dump(mode="json") for a in body.actuators] if body.actuators is not None else None
    )
    updated = await service.update_catalog_entry(entry, body.name, metrics, actuators, body.status)
    await session.flush()
    await session.refresh(updated)
    counts = await devices_service.count_devices_by_catalog_entry(session, ctx.tenant_id)
    return _to_response(updated, counts.get(updated.id, 0))


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_catalog_entry(
    entry_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await service.delete_catalog_entry(session, ctx.tenant_id, entry_id)
    except service.CatalogEntryNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found"
        ) from exc
    except service.CatalogEntryInUseError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Catalog entry is still in use by one or more devices",
        ) from exc
