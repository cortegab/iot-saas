"""Notification routes: read-only feed + mark-all-read.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in notifications/service.py. No admin gate: notifications are a tenant-wide
activity feed, not tenant configuration, so membership alone
(require_tenant_context) is enough — same reasoning dashboards/router.py uses.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.notifications import service
from app.notifications.models import Notification
from app.notifications.schemas import NotificationResponse
from app.tenants.deps import TenantContext, require_tenant_context

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_response(notification: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=notification.id,
        device_id=notification.device_id,
        rule_id=notification.rule_id,
        message=notification.message,
        created_at=notification.created_at,
        read_at=notification.read_at,
    )


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[NotificationResponse]:
    notifications = await service.list_notifications(session, ctx.tenant_id)
    return [_to_response(n) for n in notifications]


@router.post("/read", response_model=list[NotificationResponse])
async def mark_all_read(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[NotificationResponse]:
    notifications = await service.mark_all_read(session, ctx.tenant_id)
    return [_to_response(n) for n in notifications]
