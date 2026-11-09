"""Over-the-air firmware updates: thin routes over firmware/service.py."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.firmware import service
from app.firmware.schemas import FirmwareStatusResponse, FirmwareUpdateRequest
from app.tenants.deps import TenantContext, require_role
from app.tenants.models import TenantRole

router = APIRouter(prefix="/devices", tags=["firmware"])


@router.get("/{device_id}/firmware", response_model=FirmwareStatusResponse)
async def get_firmware(
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> FirmwareStatusResponse:
    return await service.firmware_status(session, device)


@router.post("/{device_id}/firmware/update", response_model=FirmwareStatusResponse)
async def update_firmware(
    body: FirmwareUpdateRequest,
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> FirmwareStatusResponse:
    try:
        return await service.request_update(session, ctx.tenant_id, device, body.version)
    except service.UpdateRefusedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
