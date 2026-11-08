"""Push-device registrations (the API side) and who a notification goes to
(the worker side).

Every function expects the tenant context already set on the session (RLS,
CLAUDE.md §9.5): the API through require_tenant_context, the sender with
set_tenant_context before calling `targets_for`.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.push.models import PushDevice
from app.tenants import service as tenants_service

# Which notification severities each setting receives. Info (a rule cleared,
# a template changed) is feed-only: it never pushes.
_RECEIVES: dict[str, set[str]] = {
    "critical": {"critical"},
    "warning": {"critical", "warning"},
}
_ALL_ROLES = {"owner", "admin", "viewer"}


class PushDeviceNotFoundError(Exception):
    pass


def receives(min_severity: str, severity: str) -> bool:
    """Whether a phone set to `min_severity` gets a notification of `severity`."""
    return severity in _RECEIVES.get(min_severity, set())


async def register(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    token: str,
    platform: str,
    *,
    min_severity: str | None = None,
    enabled: bool | None = None,
) -> PushDevice:
    """Adds the phone, or refreshes it: same token → same row, now owned by
    this user (a shared phone signed in by someone else)."""
    result = await session.execute(
        select(PushDevice).where(PushDevice.tenant_id == tenant_id, PushDevice.token == token)
    )
    device = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if device is None:
        device = PushDevice(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            user_id=user_id,
            token=token,
            platform=platform,
            min_severity=min_severity or "warning",
            enabled=True if enabled is None else enabled,
            last_seen_at=now,
        )
        session.add(device)
    else:
        device.user_id = user_id
        device.platform = platform
        device.last_seen_at = now
        if min_severity is not None:
            device.min_severity = min_severity
        if enabled is not None:
            device.enabled = enabled
    await session.flush()
    await session.refresh(device)
    return device


async def get_own(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, device_id: uuid.UUID
) -> PushDevice:
    """A user only ever sees and changes their own phones."""
    result = await session.execute(
        select(PushDevice).where(
            PushDevice.tenant_id == tenant_id,
            PushDevice.user_id == user_id,
            PushDevice.id == device_id,
        )
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise PushDeviceNotFoundError
    return device


async def update(
    session: AsyncSession,
    device: PushDevice,
    *,
    min_severity: str | None = None,
    enabled: bool | None = None,
) -> PushDevice:
    if min_severity is not None:
        device.min_severity = min_severity
    if enabled is not None:
        device.enabled = enabled
    await session.flush()
    await session.refresh(device)
    return device


async def unregister(session: AsyncSession, device: PushDevice) -> None:
    await session.delete(device)
    await session.flush()


@dataclass(frozen=True)
class Target:
    id: uuid.UUID
    token: str


async def targets_for(session: AsyncSession, tenant_id: uuid.UUID, severity: str) -> list[Target]:
    """The enabled phones of current members that want this severity. A
    member who left keeps no phone in the list, even before their rows are
    cleaned up."""
    members = set(await tenants_service.list_member_ids_by_roles(session, tenant_id, _ALL_ROLES))
    result = await session.execute(
        select(PushDevice).where(PushDevice.tenant_id == tenant_id, PushDevice.enabled.is_(True))
    )
    return [
        Target(d.id, d.token)
        for d in result.scalars().all()
        if d.user_id in members and receives(d.min_severity, severity)
    ]


async def forget_tokens(session: AsyncSession, tenant_id: uuid.UUID, ids: list[uuid.UUID]) -> None:
    """Drops registrations FCM reports as gone (app uninstalled, token
    rotated), so they're not tried again."""
    if ids:
        await session.execute(
            delete(PushDevice).where(PushDevice.tenant_id == tenant_id, PushDevice.id.in_(ids))
        )
