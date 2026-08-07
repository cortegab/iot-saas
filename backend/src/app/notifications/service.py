"""Notification creation (called from the rule-dispatch hot path) and the
read-side CRUD the API exposes.

`create_notification` mirrors `commands.service.dispatch_command`'s pattern:
called from the worker, outside any request-scoped session, so it opens and
commits its own short-lived session via the passed `async_sessionmaker`.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import set_tenant_context
from app.notifications.models import Notification
from app.realtime import service as realtime_service


async def create_notification(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    device_id: uuid.UUID | None,
    rule_id: uuid.UUID | None,
    message: str,
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
            )
        )
    await realtime_service.publish_event(
        tenant_id, {"type": "notification", "id": str(notification_id)}
    )


async def list_notifications(
    session: AsyncSession, tenant_id: uuid.UUID, limit: int = 50
) -> list[Notification]:
    result = await session.execute(
        select(Notification)
        .where(Notification.tenant_id == tenant_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_all_read(session: AsyncSession, tenant_id: uuid.UUID) -> list[Notification]:
    await session.execute(
        update(Notification)
        .where(Notification.tenant_id == tenant_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await session.flush()
    return await list_notifications(session, tenant_id)
