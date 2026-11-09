"""The signed-in user's phones that receive push notifications, per
workspace. Thin per CLAUDE.md §6: a user only sees and changes their own."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.push import service
from app.push.models import PushDevice
from app.push.schemas import PushDeviceRegisterRequest, PushDeviceResponse, PushDeviceUpdateRequest
from app.tenants.deps import TenantContext, require_tenant_context

router = APIRouter(prefix="/me/push-devices", tags=["push"])


def _to_response(d: PushDevice) -> PushDeviceResponse:
    return PushDeviceResponse(
        id=d.id,
        platform=d.platform,  # type: ignore[arg-type]
        min_severity=d.min_severity,  # type: ignore[arg-type]
        enabled=d.enabled,
        created_at=d.created_at,
        last_seen_at=d.last_seen_at,
    )


def _user(ctx: TenantContext) -> uuid.UUID:
    # API keys have no phone: push registration is for signed-in people.
    if ctx.user_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Sign in to register a phone.")
    return ctx.user_id


@router.put("", response_model=PushDeviceResponse)
async def register(
    body: PushDeviceRegisterRequest,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> PushDeviceResponse:
    device = await service.register(
        session,
        ctx.tenant_id,
        _user(ctx),
        body.token,
        body.platform,
        min_severity=body.min_severity,
        enabled=body.enabled,
    )
    return _to_response(device)


async def _own(ctx: TenantContext, session: AsyncSession, device_id: uuid.UUID) -> PushDevice:
    try:
        return await service.get_own(session, ctx.tenant_id, _user(ctx), device_id)
    except service.PushDeviceNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="This phone isn't registered."
        ) from exc


@router.patch("/{device_id}", response_model=PushDeviceResponse)
async def update(
    device_id: uuid.UUID,
    body: PushDeviceUpdateRequest,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> PushDeviceResponse:
    device = await _own(ctx, session, device_id)
    return _to_response(
        await service.update(session, device, min_severity=body.min_severity, enabled=body.enabled)
    )


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unregister(
    device_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    await service.unregister(session, await _own(ctx, session, device_id))
