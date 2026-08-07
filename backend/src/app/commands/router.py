"""Commands routes: read-only audit log listing, plus the manual (dashboard-
triggered) actuator command request.

Thin per CLAUDE.md §6 — device ownership/tenant-scoping is delegated to
devices.deps.get_device_or_404 (the same dependency devices/telemetry use),
then the query/request is delegated to commands.service.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.commands import service
from app.commands.models import Command
from app.commands.schemas import CommandResponse, ManualCommandRequest
from app.db import get_session
from app.devices.deps import get_device_or_404
from app.devices.models import Device, DeviceStatus
from app.tenants.deps import TenantContext, require_role
from app.tenants.models import TenantRole

router = APIRouter(prefix="/devices/{device_id}", tags=["commands"])


def _to_response(command: Command) -> CommandResponse:
    return CommandResponse(
        id=command.id,
        device_id=command.device_id,
        rule_id=command.rule_id,
        actuator=command.actuator,
        value=command.value,
        issued_at=command.issued_at,
        ttl_seconds=command.ttl_seconds,
        published_at=command.published_at,
        acked_at=command.acked_at,
        latency_ms=command.latency_ms,
    )


@router.get("/commands", response_model=list[CommandResponse])
async def list_commands(
    device: Device = Depends(get_device_or_404),
    session: AsyncSession = Depends(get_session),
) -> list[CommandResponse]:
    commands = await service.list_commands(session, device.tenant_id, device.id)
    return [_to_response(c) for c in commands]


@router.post("/commands", status_code=status.HTTP_202_ACCEPTED)
async def request_command(
    body: ManualCommandRequest,
    device: Device = Depends(get_device_or_404),
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    # Deliberately not gated on connection_state: an offline device still
    # receives this via its retained desired-state topic on reconnect
    # (UX_UI_Description.md §7's "honest offline behaviour" — the frontend,
    # not this 409, is what tells the user the change is pending).
    if device.status != DeviceStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Device is disabled")
    await service.request_manual_command(
        session, device.tenant_id, device.id, device.slug, body.actuator, body.value
    )
