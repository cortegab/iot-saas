"""Device routes: CRUD + credential rotation.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in devices/service.py.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service as catalog_service
from app.config import settings
from app.db import get_session
from app.devices import service
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.devices.schemas import (
    ConnectionState,
    DeviceCreateRequest,
    DeviceCreateResponse,
    DeviceCredential,
    DeviceResponse,
    DeviceUpdateRequest,
)
from app.tenants import service as tenants_service
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(prefix="/devices", tags=["devices"])


def _connection_state(last_seen_at: datetime | None) -> ConnectionState:
    if last_seen_at is None:
        return "never_connected"
    offline_after = timedelta(seconds=settings.device_offline_after_seconds)
    return "online" if datetime.now(UTC) - last_seen_at <= offline_after else "offline"


def _to_response(device: Device) -> DeviceResponse:
    return DeviceResponse(
        id=device.id,
        name=device.name,
        catalog_entry_id=device.catalog_entry_id,
        slug=device.slug,
        status=device.status,
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        connection_state=_connection_state(device.last_seen_at),
    )


@router.get("", response_model=list[DeviceResponse])
async def list_devices(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[DeviceResponse]:
    devices = await service.list_devices(session, ctx.tenant_id)
    return [_to_response(d) for d in devices]


@router.post("", response_model=DeviceCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_device(
    body: DeviceCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> DeviceCreateResponse:
    try:
        device, secret = await service.create_device(
            session, ctx.tenant_id, body.name, body.catalog_entry_id
        )
    except catalog_service.CatalogEntryNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found"
        ) from exc
    tenant_slug = await tenants_service.get_tenant_slug(session, ctx.tenant_id)
    return DeviceCreateResponse(
        device=_to_response(device),
        credential=DeviceCredential(username=str(device.id), password=secret),
        tenant_slug=tenant_slug,
    )


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(device: Device = Depends(get_device_or_404)) -> DeviceResponse:
    return _to_response(device)


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(
    body: DeviceUpdateRequest,
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> DeviceResponse:
    updated = await service.update_device(session, ctx.tenant_id, device.id, body.name, body.status)
    return _to_response(updated)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_device(session, ctx.tenant_id, device.id)


@router.post("/{device_id}/rotate-credential", response_model=DeviceCreateResponse)
async def rotate_credential(
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> DeviceCreateResponse:
    updated, secret = await service.rotate_credential(session, ctx.tenant_id, device.id)
    tenant_slug = await tenants_service.get_tenant_slug(session, ctx.tenant_id)
    return DeviceCreateResponse(
        device=_to_response(updated),
        credential=DeviceCredential(username=str(updated.id), password=secret),
        tenant_slug=tenant_slug,
    )
