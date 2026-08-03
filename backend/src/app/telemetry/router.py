"""Telemetry query routes: GET /devices/{device_id}/latest and
GET /devices/{device_id}/data. Thin per CLAUDE.md §6 — device ownership and
tenant-scoping are delegated to devices.deps.get_device_or_404 (the same
dependency devices/router.py itself uses — cross-tenant ids 404, not 403),
then the query is delegated to telemetry.service.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.devices.deps import get_device_or_404
from app.devices.models import Device
from app.telemetry import service
from app.telemetry.schemas import TelemetryDataResponse, TelemetryLatestResponse

router = APIRouter(prefix="/devices/{device_id}", tags=["telemetry"])


@router.get("/latest", response_model=list[TelemetryLatestResponse])
async def latest(
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session),
) -> list[TelemetryLatestResponse]:
    return await service.get_latest(session, device.tenant_id, device.id)


@router.get("/data", response_model=TelemetryDataResponse)
async def data(
    metric: str,
    from_: datetime = Query(alias="from"),
    to: datetime | None = Query(default=None),
    resolution: str = Query(default="raw"),
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session),
) -> TelemetryDataResponse:
    if resolution not in service.VALID_RESOLUTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"invalid resolution: {resolution!r}"
        )
    return await service.get_range(
        session, device.tenant_id, device.id, metric, from_, to or datetime.now(UTC), resolution
    )
