"""Device routes: CRUD + credential rotation.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in devices/service.py.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices import service
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.devices.schemas import (
    DeviceCreateRequest,
    DeviceCreateResponse,
    DeviceCredential,
    DeviceResponse,
    DeviceUpdateRequest,
)
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import TenantRole

router = APIRouter(prefix="/devices", tags=["devices"])


def _to_response(device: Device) -> DeviceResponse:
    return DeviceResponse(
        id=device.id,
        name=device.name,
        slug=device.slug,
        status=device.status,
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
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
    device, secret = await service.create_device(session, ctx.tenant_id, body.name)
    return DeviceCreateResponse(
        device=_to_response(device),
        credential=DeviceCredential(username=str(device.id), password=secret),
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
    return DeviceCreateResponse(
        device=_to_response(updated),
        credential=DeviceCredential(username=str(updated.id), password=secret),
    )
