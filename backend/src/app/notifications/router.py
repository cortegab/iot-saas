"""Notification routes: the feed, read/unread, dismiss/restore.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in notifications/service.py. No admin gate: notifications are a tenant-wide
activity feed, not tenant configuration, so membership alone
(require_tenant_context) is enough — same reasoning dashboards/router.py uses.
"""

import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.notifications import service
from app.notifications.models import Notification
from app.notifications.schemas import NotificationResponse
from app.tenants.deps import TenantContext, require_tenant_context

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_response(notification: Notification) -> NotificationResponse:
    return NotificationResponse.model_validate(notification, from_attributes=True)


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[NotificationResponse]:
    notifications = await service.list_notifications(session, ctx.tenant_id)
    return [_to_response(n) for n in notifications]


@router.post("/read", response_model=list[NotificationResponse])
async def mark_all_read(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[NotificationResponse]:
    notifications = await service.mark_all_read(session, ctx.tenant_id)
    return [_to_response(n) for n in notifications]


async def _one(
    op: Callable[[AsyncSession, uuid.UUID, uuid.UUID], Awaitable[Notification]],
    session: AsyncSession,
    ctx: TenantContext,
    notification_id: uuid.UUID,
) -> NotificationResponse:
    try:
        notification = await op(session, ctx.tenant_id, notification_id)
    except service.NotificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        ) from exc
    return _to_response(notification)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(
    notification_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationResponse:
    return await _one(service.mark_read, session, ctx, notification_id)


@router.patch("/{notification_id}/unread", response_model=NotificationResponse)
async def mark_unread(
    notification_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationResponse:
    return await _one(service.mark_unread, session, ctx, notification_id)


@router.post("/{notification_id}/dismiss", response_model=NotificationResponse)
async def dismiss(
    notification_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationResponse:
    return await _one(service.dismiss, session, ctx, notification_id)


@router.post("/{notification_id}/restore", response_model=NotificationResponse)
async def restore(
    notification_id: uuid.UUID,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationResponse:
    return await _one(service.restore, session, ctx, notification_id)
