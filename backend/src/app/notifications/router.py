"""Notification routes: the feed, read/unread, dismiss/restore.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in notifications/service.py. No admin gate: notifications are a tenant-wide
activity feed, not tenant configuration, so membership alone
(require_tenant_context) is enough — same reasoning dashboards/router.py uses.
"""

import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.notifications import service
from app.notifications.models import Notification
from app.notifications.schemas import (
    NotificationGroupResponse,
    NotificationIdsRequest,
    NotificationResponse,
    NotificationSummaryResponse,
    NotificationType,
    Severity,
)
from app.paging import OFFSET, limit_param, set_total
from app.tenants.deps import TenantContext, require_tenant_context

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_response(notification: Notification) -> NotificationResponse:
    return NotificationResponse.model_validate(notification, from_attributes=True)


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    response: Response,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
    limit: int = limit_param(50),
    offset: int = OFFSET,
) -> list[NotificationResponse]:
    """Newest first, paged; the total is in X-Total-Count (app/paging.py)."""
    notifications = await service.list_notifications(
        session, ctx.tenant_id, limit=limit, offset=offset
    )
    set_total(response, await service.count_notifications(session, ctx.tenant_id))
    return [_to_response(n) for n in notifications]


@router.get("/groups", response_model=list[NotificationGroupResponse])
async def list_groups(
    response: Response,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
    limit: int = limit_param(25),
    offset: int = OFFSET,
    type: NotificationType | None = None,
    severity: Severity | None = None,
    device_id: uuid.UUID | None = None,
    rule_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=200),
    unread: bool = False,
) -> list[NotificationGroupResponse]:
    """Alerts: repeats of one alert from one source as one row, the most
    recent first, filtered and paged; the total is in X-Total-Count."""
    filters = service.FeedFilters(
        type=type, severity=severity, device_id=device_id, rule_id=rule_id, q=q, unread=unread
    )
    groups, total = await service.list_groups(
        session, ctx.tenant_id, filters, limit=limit, offset=offset
    )
    set_total(response, total)
    return [
        NotificationGroupResponse(
            key=g.key,
            latest=_to_response(g.latest),
            count=g.count,
            unread_count=g.unread_count,
            first_at=g.first_at,
            last_at=g.last_at,
        )
        for g in groups
    ]


@router.get("/summary", response_model=NotificationSummaryResponse)
async def summary(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationSummaryResponse:
    """Alerts and unread alerts by type, for the state filter and the nav."""
    s = await service.summarize(session, ctx.tenant_id)
    return NotificationSummaryResponse(
        alerts=s.alerts,
        unread=s.unread,
        unread_by_type=s.unread_by_type,
        device_ids=s.device_ids,
        rule_ids=s.rule_ids,
    )


def _group_key(key: str) -> service.GroupKey:
    try:
        return service.decode_group_key(key)
    except service.InvalidGroupKeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        ) from exc


@router.get("/groups/{key}/items", response_model=list[NotificationResponse])
async def list_group_items(
    key: str,
    response: Response,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
    limit: int = limit_param(25),
    offset: int = OFFSET,
) -> list[NotificationResponse]:
    """Each time one alert happened, newest first, paged."""
    items, total = await service.list_group_items(
        session, ctx.tenant_id, _group_key(key), limit=limit, offset=offset
    )
    set_total(response, total)
    return [_to_response(n) for n in items]


@router.post("/groups/{key}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_group_read(
    key: str,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    await service.mark_group_read(session, ctx.tenant_id, _group_key(key))


@router.post("/groups/{key}/unread", status_code=status.HTTP_204_NO_CONTENT)
async def mark_group_unread(
    key: str,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    try:
        await service.mark_group_unread(session, ctx.tenant_id, _group_key(key))
    except service.NotificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        ) from exc


@router.post("/groups/{key}/dismiss", response_model=NotificationIdsRequest)
async def dismiss_group(
    key: str,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NotificationIdsRequest:
    """Dismisses every repeat; returns their ids for Undo (POST /restore)."""
    try:
        ids = await service.dismiss_group(session, ctx.tenant_id, _group_key(key))
    except service.NotificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found"
        ) from exc
    return NotificationIdsRequest(ids=ids)


@router.post("/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_many(
    body: NotificationIdsRequest,
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    """Undo a group dismissal."""
    await service.restore_many(session, ctx.tenant_id, body.ids)


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
