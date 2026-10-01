"""Notification creation and the read-side CRUD the API exposes.

Two ways in:
- `create_notification` — from the worker (rule firings, device offline,
  failed deliveries), outside any request-scoped session, so it opens and
  commits its own short-lived session via the passed `async_sessionmaker`
  (mirrors `commands.service.dispatch_command`).
- `add_notification` — from an API request (a template changed), inside the
  request's transaction; the realtime event goes out only after it commits.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import add_post_commit_callback, set_tenant_context
from app.notifications.models import Notification
from app.notifications.schemas import NotificationKind, Severity
from app.realtime import service as realtime_service


class NotificationNotFoundError(Exception):
    pass


async def create_notification(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID | None,
    rule_id: uuid.UUID | None,
    message: str,
    *,
    severity: Severity = "warning",
    kind: NotificationKind = "rule_fired",
    detail: str | None = None,
) -> None:
    notification_id = uuid.uuid4()
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        session.add(
            Notification(
                id=notification_id,
                tenant_id=tenant_id,
                device_id=device_id,
                rule_id=rule_id,
                message=message,
                detail=detail,
                severity=severity,
                kind=kind,
            )
        )
    await realtime_service.publish_event(
        tenant_id, {"type": "notification", "id": str(notification_id)}
    )


async def add_notification(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    message: str,
    *,
    severity: Severity = "info",
    kind: NotificationKind,
    detail: str | None = None,
    device_id: uuid.UUID | None = None,
    rule_id: uuid.UUID | None = None,
    catalog_entry_id: uuid.UUID | None = None,
) -> None:
    """In-request variant: joins the caller's transaction (tenant context
    already set), publishes the realtime event after commit."""
    notification_id = uuid.uuid4()
    session.add(
        Notification(
            id=notification_id,
            tenant_id=tenant_id,
            device_id=device_id,
            rule_id=rule_id,
            catalog_entry_id=catalog_entry_id,
            message=message,
            detail=detail,
            severity=severity,
            kind=kind,
        )
    )

    async def _publish() -> None:
        await realtime_service.publish_event(
            tenant_id, {"type": "notification", "id": str(notification_id)}
        )

    add_post_commit_callback(session, _publish)


async def list_notifications(
    session: AsyncSession, tenant_id: uuid.UUID, limit: int = 50
) -> list[Notification]:
    """The feed: newest first, dismissed rows left out."""
    result = await session.execute(
        select(Notification)
        .where(Notification.tenant_id == tenant_id, Notification.dismissed_at.is_(None))
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_all_read(session: AsyncSession, tenant_id: uuid.UUID) -> list[Notification]:
    await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == tenant_id,
            Notification.read_at.is_(None),
            Notification.dismissed_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    await session.flush()
    return await list_notifications(session, tenant_id)


async def _get(
    session: AsyncSession, tenant_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    result = await session.execute(
        select(Notification).where(
            Notification.tenant_id == tenant_id, Notification.id == notification_id
        )
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise NotificationNotFoundError
    return notification


async def mark_read(
    session: AsyncSession, tenant_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    notification = await _get(session, tenant_id, notification_id)
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        await session.flush()
    return notification


async def mark_unread(
    session: AsyncSession, tenant_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    notification = await _get(session, tenant_id, notification_id)
    if notification.read_at is not None:
        notification.read_at = None
        await session.flush()
    return notification


async def dismiss(
    session: AsyncSession, tenant_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    """Dismissing also reads it — a dismissed row never counts as unread."""
    notification = await _get(session, tenant_id, notification_id)
    now = datetime.now(UTC)
    if notification.dismissed_at is None:
        notification.dismissed_at = now
    if notification.read_at is None:
        notification.read_at = now
    await session.flush()
    return notification


async def restore(
    session: AsyncSession, tenant_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    """Undo a dismissal."""
    notification = await _get(session, tenant_id, notification_id)
    if notification.dismissed_at is not None:
        notification.dismissed_at = None
        await session.flush()
    return notification
