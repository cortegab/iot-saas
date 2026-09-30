"""Zone routes: CRUD for the places devices are installed in.

Thin per CLAUDE.md §6. Reads are member-accessible; writes are admin-gated
via require_role, like the catalog and device routes.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices import service as devices_service
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole
from app.zones import service
from app.zones.deps import get_zone_or_404
from app.zones.models import Zone
from app.zones.schemas import ZoneCreateRequest, ZoneResponse, ZoneUpdateRequest

router = APIRouter(prefix="/zones", tags=["zones"])


def _to_response(zone: Zone, device_count: int) -> ZoneResponse:
    return ZoneResponse(
        id=zone.id,
        name=zone.name,
        notes=zone.notes,
        device_count=device_count,
        created_at=zone.created_at,
        updated_at=zone.updated_at,
    )


def _name_taken() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail="Another zone already has this name."
    )


@router.get("", response_model=list[ZoneResponse])
async def list_zones(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneResponse]:
    zones = await service.list_zones(session, ctx.tenant_id)
    counts = await devices_service.count_devices_by_zone(session, ctx.tenant_id)
    return [_to_response(z, counts.get(z.id, 0)) for z in zones]


@router.post("", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
async def create_zone(
    body: ZoneCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> ZoneResponse:
    try:
        zone = await service.create_zone(session, ctx.tenant_id, body.name, body.notes)
    except service.ZoneNameTakenError as exc:
        raise _name_taken() from exc
    await session.refresh(zone)
    return _to_response(zone, 0)


@router.get("/{zone_id}", response_model=ZoneResponse)
async def get_zone(
    zone: Zone = Depends(get_zone_or_404),
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> ZoneResponse:
    counts = await devices_service.count_devices_by_zone(session, ctx.tenant_id)
    return _to_response(zone, counts.get(zone.id, 0))


@router.patch("/{zone_id}", response_model=ZoneResponse)
async def update_zone(
    body: ZoneUpdateRequest,
    zone: Zone = Depends(get_zone_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> ZoneResponse:
    try:
        updated = await service.update_zone(
            session, zone, body.name, body.notes, notes_set="notes" in body.model_fields_set
        )
    except service.ZoneNameTakenError as exc:
        raise _name_taken() from exc
    await session.refresh(updated)
    counts = await devices_service.count_devices_by_zone(session, ctx.tenant_id)
    return _to_response(updated, counts.get(updated.id, 0))


@router.delete("/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(
    zone: Zone = Depends(get_zone_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await service.delete_zone(session, zone)
    except service.ZoneInUseError as exc:
        n = exc.device_count
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{n} device{'s are' if n != 1 else ' is'} assigned to this zone. "
            "Move them to another zone first.",
        ) from exc
