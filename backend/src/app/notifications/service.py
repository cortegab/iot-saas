"""Notification creation and the read-side CRUD the API exposes.

Two ways in:
- `create_notification` — from the worker (rule firings, device offline,
  failed deliveries), outside any request-scoped session, so it opens and
  commits its own short-lived session via the passed `async_sessionmaker`
  (mirrors `commands.service.dispatch_command`).
- `add_notification` — from an API request (a template changed), inside the
  request's transaction; the realtime event goes out only after it commits.
"""

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import ARRAY, ColumnElement, Uuid, func, or_, select, update
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import InstrumentedAttribute

from app.db import add_post_commit_callback, set_tenant_context
from app.notifications.models import Notification
from app.notifications.schemas import (
    KIND_TYPE,
    NotificationKind,
    NotificationType,
    Severity,
)
from app.realtime import service as realtime_service


class NotificationNotFoundError(Exception):
    pass


class InvalidGroupKeyError(Exception):
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
    session: AsyncSession, tenant_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> list[Notification]:
    """The feed: newest first, dismissed rows left out; id breaks ties so
    pages never repeat or skip a row."""
    result = await session.execute(
        select(Notification)
        .where(Notification.tenant_id == tenant_id, Notification.dismissed_at.is_(None))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def count_notifications(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.tenant_id == tenant_id, Notification.dismissed_at.is_(None))
    )
    return int(result.scalar_one())


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


# --- Groups ----------------------------------------------------------------
# Repeats of one alert from one source are one row on the page. Grouping
# happens here, so the page can number its pages over every alert and the
# ×N counts cover all of history, not only what one request loaded.


@dataclass(frozen=True)
class GroupKey:
    kind: NotificationKind
    rule_id: uuid.UUID | None
    device_id: uuid.UUID | None
    catalog_entry_id: uuid.UUID | None
    message: str


_KEY_ADAPTER: TypeAdapter[
    tuple[NotificationKind, uuid.UUID | None, uuid.UUID | None, uuid.UUID | None, str]
] = TypeAdapter(tuple[NotificationKind, uuid.UUID | None, uuid.UUID | None, uuid.UUID | None, str])

_GROUP_COLUMNS = (
    Notification.kind,
    Notification.rule_id,
    Notification.device_id,
    Notification.catalog_entry_id,
    Notification.message,
)


def encode_group_key(key: GroupKey) -> str:
    raw = [
        key.kind,
        str(key.rule_id) if key.rule_id else None,
        str(key.device_id) if key.device_id else None,
        str(key.catalog_entry_id) if key.catalog_entry_id else None,
        key.message,
    ]
    return base64.urlsafe_b64encode(json.dumps(raw).encode()).rstrip(b"=").decode()


def decode_group_key(token: str) -> GroupKey:
    """The opaque `key` back into its parts; anything malformed is an
    InvalidGroupKeyError (the route answers 404)."""
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        kind, rule_id, device_id, catalog_entry_id, message = _KEY_ADAPTER.validate_json(raw)
    except (binascii.Error, ValueError, ValidationError) as exc:
        raise InvalidGroupKeyError from exc
    return GroupKey(kind, rule_id, device_id, catalog_entry_id, message)


def _matches_key(key: GroupKey) -> list[ColumnElement[bool]]:
    """NULL-safe equality on every key column."""
    values = (key.kind, key.rule_id, key.device_id, key.catalog_entry_id, key.message)
    return [
        column.is_(None) if value is None else column == value
        for column, value in zip(_GROUP_COLUMNS, values, strict=True)
    ]


def _feed(tenant_id: uuid.UUID) -> list[ColumnElement[bool]]:
    return [Notification.tenant_id == tenant_id, Notification.dismissed_at.is_(None)]


@dataclass(frozen=True)
class FeedFilters:
    """Filters on notifications, applied before grouping."""

    type: NotificationType | None = None
    severity: Severity | None = None
    device_id: uuid.UUID | None = None
    rule_id: uuid.UUID | None = None
    q: str | None = None
    # Only groups with something unread.
    unread: bool = False


async def _filter_clauses(
    session: AsyncSession, tenant_id: uuid.UUID, f: FeedFilters
) -> list[ColumnElement[bool]]:
    where = _feed(tenant_id)
    if f.type:
        where.append(Notification.kind.in_([k for k, t in KIND_TYPE.items() if t == f.type]))
    if f.severity:
        where.append(Notification.severity == f.severity)
    if f.device_id:
        where.append(Notification.device_id == f.device_id)
    if f.rule_id:
        where.append(Notification.rule_id == f.rule_id)
    if f.q and f.q.strip():
        where.append(await _search(session, tenant_id, f.q.strip()))
    return where


async def _search(session: AsyncSession, tenant_id: uuid.UUID, q: str) -> ColumnElement[bool]:
    """The text, or the name of the device, rule or template it came from.
    Names come through each module's service (CLAUDE.md §6); the lists are
    small (one tenant's devices, rules and templates). Imported here: rules
    and catalog import this module to write notifications."""
    from app.catalog import service as catalog_service
    from app.devices import service as devices_service
    from app.rules import service as rules_service

    needle = q.casefold()
    pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    devices = [
        d.id
        for d in await devices_service.list_devices(session, tenant_id)
        if needle in d.name.casefold()
    ]
    rules = [
        r.id
        for r in await rules_service.list_all_rules(session, tenant_id)
        if needle in r.name.casefold()
    ]
    templates = [
        t.id
        for t in await catalog_service.list_catalog_entries(session, tenant_id)
        if needle in t.name.casefold()
    ]
    return or_(
        Notification.message.ilike(pattern, escape="\\"),
        Notification.detail.ilike(pattern, escape="\\"),
        Notification.device_id.in_(devices),
        Notification.rule_id.in_(rules),
        Notification.catalog_entry_id.in_(templates),
    )


@dataclass(frozen=True)
class NotificationGroup:
    key: str
    latest: Notification
    count: int
    unread_count: int
    first_at: datetime
    last_at: datetime


async def list_groups(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    filters: FeedFilters,
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[NotificationGroup], int]:
    """One page of alert groups, the most recently repeated first, and how
    many groups match in all."""
    unread = func.count().filter(Notification.read_at.is_(None))
    last_at = func.max(Notification.created_at)
    latest_id = func.array_agg(
        aggregate_order_by(Notification.id, Notification.created_at.desc(), Notification.id.desc()),
        type_=ARRAY(Uuid),
    )[1]
    grouped = (
        select(
            *_GROUP_COLUMNS,
            func.count().label("repeats"),
            unread.label("unread_count"),
            func.min(Notification.created_at).label("first_at"),
            last_at.label("last_at"),
            latest_id.label("latest_id"),
        )
        .where(*await _filter_clauses(session, tenant_id, filters))
        .group_by(*_GROUP_COLUMNS)
    )
    if filters.unread:
        grouped = grouped.having(unread > 0)

    total = int(
        (await session.execute(select(func.count()).select_from(grouped.subquery()))).scalar_one()
    )
    rows = (
        await session.execute(
            grouped.order_by(last_at.desc(), Notification.kind, Notification.message)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    if not rows:
        return [], total
    latest = {
        n.id: n
        for n in (
            await session.execute(
                select(Notification).where(Notification.id.in_([r.latest_id for r in rows]))
            )
        ).scalars()
    }
    groups = [
        NotificationGroup(
            key=encode_group_key(
                GroupKey(r.kind, r.rule_id, r.device_id, r.catalog_entry_id, r.message)
            ),
            latest=latest[r.latest_id],
            count=r.repeats,
            unread_count=r.unread_count,
            first_at=r.first_at,
            last_at=r.last_at,
        )
        for r in rows
    ]
    return groups, total


@dataclass(frozen=True)
class FeedSummary:
    alerts: int
    unread: int
    unread_by_type: dict[NotificationType, int]
    device_ids: list[uuid.UUID]
    rule_ids: list[uuid.UUID]


async def count_unread_critical(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Critical alerts (rows of repeats) with something unread."""
    _, total = await list_groups(
        session, tenant_id, FeedFilters(severity="critical", unread=True), limit=1
    )
    return total


async def summarize(session: AsyncSession, tenant_id: uuid.UUID) -> FeedSummary:
    """Alerts (groups) in the feed and how many are unread, by type; and the
    devices and rules that have any, for the page's filters."""
    grouped = (
        select(
            Notification.kind,
            func.count().filter(Notification.read_at.is_(None)).label("unread"),
        )
        .where(*_feed(tenant_id))
        .group_by(*_GROUP_COLUMNS)
        .subquery()
    )
    by_kind = (
        await session.execute(
            select(
                grouped.c.kind,
                func.count(),
                func.count().filter(grouped.c.unread > 0),
            ).group_by(grouped.c.kind)
        )
    ).all()
    unread_by_type: dict[NotificationType, int] = dict.fromkeys(sorted(set(KIND_TYPE.values())), 0)
    for kind, _, unread in by_kind:
        unread_by_type[KIND_TYPE[kind]] += unread

    async def _sources(column: InstrumentedAttribute[uuid.UUID | None]) -> list[uuid.UUID]:
        result = await session.execute(
            select(column).where(*_feed(tenant_id), column.is_not(None)).distinct()
        )
        return [v for v in result.scalars() if v is not None]

    return FeedSummary(
        alerts=sum(total for _, total, _ in by_kind),
        unread=sum(unread_by_type.values()),
        unread_by_type=unread_by_type,
        device_ids=await _sources(Notification.device_id),
        rule_ids=await _sources(Notification.rule_id),
    )


async def list_group_items(
    session: AsyncSession, tenant_id: uuid.UUID, key: GroupKey, limit: int = 25, offset: int = 0
) -> tuple[list[Notification], int]:
    """Each time the alert happened, newest first."""
    where = [*_feed(tenant_id), *_matches_key(key)]
    total = int(
        (
            await session.execute(select(func.count()).select_from(Notification).where(*where))
        ).scalar_one()
    )
    result = await session.execute(
        select(Notification)
        .where(*where)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total


async def mark_group_read(session: AsyncSession, tenant_id: uuid.UUID, key: GroupKey) -> int:
    result = await session.execute(
        update(Notification)
        .where(*_feed(tenant_id), *_matches_key(key), Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
        .returning(Notification.id)
    )
    return len(result.all())


async def mark_group_unread(session: AsyncSession, tenant_id: uuid.UUID, key: GroupKey) -> None:
    """The newest one goes back to unread, so the group reads as unread
    without un-reading its whole history."""
    result = await session.execute(
        select(Notification)
        .where(*_feed(tenant_id), *_matches_key(key))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    if latest is None:
        raise NotificationNotFoundError
    latest.read_at = None
    await session.flush()


async def dismiss_group(
    session: AsyncSession, tenant_id: uuid.UUID, key: GroupKey
) -> list[uuid.UUID]:
    """Dismisses every repeat (and reads it, like `dismiss`); returns their ids
    so Undo can restore exactly these."""
    now = datetime.now(UTC)
    result = await session.execute(
        update(Notification)
        .where(*_feed(tenant_id), *_matches_key(key))
        .values(dismissed_at=now, read_at=func.coalesce(Notification.read_at, now))
        .returning(Notification.id)
    )
    ids = list(result.scalars().all())
    if not ids:
        raise NotificationNotFoundError
    return ids


async def restore_many(session: AsyncSession, tenant_id: uuid.UUID, ids: list[uuid.UUID]) -> int:
    """Undo a group dismissal."""
    if not ids:
        return 0
    result = await session.execute(
        update(Notification)
        .where(
            Notification.tenant_id == tenant_id,
            Notification.id.in_(ids),
            Notification.dismissed_at.is_not(None),
        )
        .values(dismissed_at=None)
        .returning(Notification.id)
    )
    return len(result.all())
