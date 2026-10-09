"""Tenant creation and membership queries."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service as catalog_service
from app.db import set_tenant_context
from app.shared.slug import slugify
from app.tenants.models import Invitation, Tenant, TenantMembership, TenantRole

LEGACY_CATALOG_ENTRY_NAME = "Legacy / Uncategorized"


class NotAMemberError(Exception):
    pass


class AlreadyAMemberError(Exception):
    pass


async def _unique_slug(session: AsyncSession, name: str) -> str:
    base = slugify(name, fallback="tenant")
    slug = base
    suffix = 1
    while (
        await session.execute(select(Tenant.id).where(Tenant.slug == slug))
    ).scalar_one_or_none() is not None:
        suffix += 1
        slug = f"{base}-{suffix}"
    return slug


async def create_tenant_with_owner(session: AsyncSession, user_id: uuid.UUID, name: str) -> Tenant:
    """Create a tenant and insert its owner membership in one step.

    Sets tenant context itself, immediately after creating the tenant, so the
    membership insert's WITH CHECK passes — the one place outside the HTTP
    dependency layer (tenants.deps.require_tenant_context) that calls
    set_tenant_context directly. This is sanctioned, not a bypass: the caller
    is, by construction, entitled to own the tenant they just created.

    Also seeds a "Legacy / Uncategorized" catalog entry (empty metrics/
    actuators) — the same one the device-catalog backfill migration creates
    for pre-existing tenants — so a brand new tenant's first device creation
    is never catalog-first-blocked. A cross-module service call, not a
    `from app.catalog.models import ...` here (CLAUDE.md §6).
    """
    slug = await _unique_slug(session, name)
    tenant = Tenant(name=name, slug=slug)
    session.add(tenant)
    await session.flush()  # populate tenant.id for the membership insert

    await set_tenant_context(session, tenant.id)
    session.add(TenantMembership(tenant_id=tenant.id, user_id=user_id, role=TenantRole.OWNER.value))
    await catalog_service.create_catalog_entry(
        session, tenant.id, LEGACY_CATALOG_ENTRY_NAME, [], [], is_legacy=True
    )
    await session.flush()
    return tenant


async def get_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> Tenant:
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one()


async def update_tenant(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str | None = None,
    notification_emails: list[str] | None = None,
    timezone: str | None = None,
) -> Tenant:
    """Update workspace settings. Callers gate this by role (tenants/router.py:
    admins for recipients and time zone, owners for the name) — `tenants`
    itself carries no RLS (see tenants/models.py's docstring), so the role
    check at the route layer is the only thing standing between any member
    and editing the whole workspace.
    """
    tenant = await get_tenant(session, tenant_id)
    if name is not None:
        tenant.name = name
    if notification_emails is not None:
        tenant.notification_emails = [e.strip() for e in notification_emails if e.strip()]
    if timezone is not None:
        tenant.timezone = timezone
    await session.flush()
    return tenant


async def list_member_ids_by_roles(
    session: AsyncSession, tenant_id: uuid.UUID, roles: set[str]
) -> list[uuid.UUID]:
    """user_ids of every member of the tenant in context whose role is in
    `roles`. Relies on tenant_memberships' RLS tenant_id branch — the caller
    must have set_tenant_context. Email enrichment is the caller's job (via
    auth.service.get_emails_by_user_ids) so this module never imports
    app.auth.models.User.
    """
    result = await session.execute(
        select(TenantMembership.user_id).where(
            TenantMembership.tenant_id == tenant_id, TenantMembership.role.in_(roles)
        )
    )
    return list(result.scalars().all())


async def get_tenant_slug(session: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The one place other modules go for "what's this tenant's slug" (e.g.
    devices/router.py building an MQTT-topic-ready credential response,
    commands/service.py publishing a manual command) — a cross-module
    service call, not a `from app.tenants.models import Tenant` in the
    caller (CLAUDE.md §6 forbids the latter, not the former).
    """
    result = await session.execute(select(Tenant.slug).where(Tenant.id == tenant_id))
    return result.scalar_one()


async def list_my_tenants(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[Tenant, str]]:
    """List every tenant the given user belongs to, with their role in each.

    Relies on tenant_memberships' dual-predicate RLS policy's user_id branch,
    so the caller must have already called set_user_context in the same
    transaction (auth.deps.get_current_user, or auth.service's register/login
    flows, do this before calling here).
    """
    result = await session.execute(
        select(Tenant, TenantMembership.role)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == user_id)
    )
    return [(tenant, role) for tenant, role in result.all()]


async def verify_membership(
    session: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> str | None:
    """Return the caller's role in the given tenant, or None if not a member.

    Relies on tenant_memberships' RLS user_id branch — set_user_context must
    already have been called in this transaction (auth.deps.get_current_user
    does this for every authenticated request).
    """
    result = await session.execute(
        select(TenantMembership.role).where(
            TenantMembership.user_id == user_id, TenantMembership.tenant_id == tenant_id
        )
    )
    return result.scalar_one_or_none()


async def list_members(
    session: AsyncSession, tenant_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, datetime]]:
    """List (user_id, role) for every member of the tenant currently in context.

    Relies on tenant_memberships' RLS tenant_id branch — the caller must have
    already called set_tenant_context (tenants.deps.require_tenant_context does
    this). Returns no emails — enriching with email is the router's job, via
    auth.service.get_emails_by_user_ids, so this module never imports
    app.auth.models.User directly.
    """
    result = await session.execute(
        select(TenantMembership.user_id, TenantMembership.role, TenantMembership.created_at).where(
            TenantMembership.tenant_id == tenant_id
        )
    )
    return [(user_id, role, joined) for user_id, role, joined in result.all()]


async def add_member(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, role: TenantRole
) -> None:
    if await verify_membership(session, user_id, tenant_id) is not None:
        raise AlreadyAMemberError
    session.add(TenantMembership(tenant_id=tenant_id, user_id=user_id, role=role.value))
    await session.flush()


async def change_role(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    role: TenantRole,
    actor_role: str,
) -> None:
    """Only an owner grants Owner or changes an owner's role; nobody grants
    above their own role; the last owner can't be demoted."""
    membership = await _membership(session, tenant_id, user_id)
    if membership.role == TenantRole.OWNER.value and actor_role != TenantRole.OWNER.value:
        raise RoleEscalationError
    assert_can_assign(actor_role, role)
    if (
        membership.role == TenantRole.OWNER.value
        and role != TenantRole.OWNER
        and await _owner_count(session, tenant_id) <= 1
    ):
        raise LastOwnerError
    membership.role = role.value
    await session.flush()


async def remove_member(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, actor_role: str
) -> None:
    """Only an owner removes an owner; the last owner can't be removed (or
    leave) — the workspace would be left without one."""
    membership = await _membership(session, tenant_id, user_id)
    if membership.role == TenantRole.OWNER.value:
        if actor_role != TenantRole.OWNER.value:
            raise RoleEscalationError
        if await _owner_count(session, tenant_id) <= 1:
            raise LastOwnerError
    await session.delete(membership)
    await session.flush()


# ---- role guards (DESIGN.md §8 members; redesign audit P0) ------------------

_RANK = {TenantRole.VIEWER.value: 0, TenantRole.ADMIN.value: 1, TenantRole.OWNER.value: 2}


class RoleEscalationError(Exception):
    """An actor tried to grant, change or remove a role above their own."""


class LastOwnerError(Exception):
    """The change would leave the workspace without an owner."""


async def _owner_count(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(TenantMembership)
        .where(
            TenantMembership.tenant_id == tenant_id, TenantMembership.role == TenantRole.OWNER.value
        )
    )
    return int(result.scalar_one())


async def _membership(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> TenantMembership:
    result = await session.execute(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise NotAMemberError
    return membership


def assert_can_assign(actor_role: str, role: TenantRole) -> None:
    """Nobody can grant a role above their own; only an owner grants Owner."""
    if _RANK[role.value] > _RANK[actor_role]:
        raise RoleEscalationError


# ---- invitations -------------------------------------------------------------

INVITE_TTL = timedelta(days=7)


class InvitationNotFoundError(Exception):
    pass


class InvitationUnusableError(Exception):
    """Expired, revoked or already accepted."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AlreadyInvitedError(Exception):
    pass


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> str:
    return secrets.token_urlsafe(32)


async def list_invitations(session: AsyncSession, tenant_id: uuid.UUID) -> list[Invitation]:
    """Pending (not accepted, not revoked) invitations, newest first."""
    result = await session.execute(
        select(Invitation)
        .where(
            Invitation.tenant_id == tenant_id,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .order_by(Invitation.created_at.desc())
    )
    return list(result.scalars().all())


async def create_invitation(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    email: str,
    role: TenantRole,
    invited_by: uuid.UUID,
    existing_member_ids: set[uuid.UUID] | None = None,
    invitee_id: uuid.UUID | None = None,
) -> tuple[Invitation, str]:
    """Returns the invitation and its one-time raw token (for the email link)."""
    normalized = email.strip().lower()
    if invitee_id is not None and existing_member_ids and invitee_id in existing_member_ids:
        raise AlreadyAMemberError
    pending = await session.execute(
        select(Invitation.id).where(
            Invitation.tenant_id == tenant_id,
            func.lower(Invitation.email) == normalized,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > datetime.now(UTC),
        )
    )
    if pending.first() is not None:
        raise AlreadyInvitedError
    token = _new_token()
    invitation = Invitation(
        tenant_id=tenant_id,
        email=normalized,
        role=role.value,
        token_hash=_token_hash(token),
        invited_by=invited_by,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    session.add(invitation)
    await session.flush()
    return invitation, token


async def get_invitation(
    session: AsyncSession, tenant_id: uuid.UUID, invitation_id: uuid.UUID
) -> Invitation:
    result = await session.execute(
        select(Invitation).where(Invitation.tenant_id == tenant_id, Invitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()
    if (
        invitation is None
        or invitation.accepted_at is not None
        or invitation.revoked_at is not None
    ):
        raise InvitationNotFoundError
    return invitation


async def renew_invitation(session: AsyncSession, invitation: Invitation) -> str:
    """Resend: a fresh token and a fresh 7 days; the old link stops working."""
    token = _new_token()
    invitation.token_hash = _token_hash(token)
    invitation.expires_at = datetime.now(UTC) + INVITE_TTL
    await session.flush()
    return token


async def revoke_invitation(session: AsyncSession, invitation: Invitation) -> None:
    invitation.revoked_at = datetime.now(UTC)
    await session.flush()


class InvitationPreview(NamedTuple):
    id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_name: str
    email: str
    role: str
    expires_at: datetime


async def lookup_invitation(session: AsyncSession, token: str) -> InvitationPreview:
    """Resolve a raw token without a tenant context (SECURITY DEFINER
    lookup_invitation). Raises for unknown, expired, revoked or used links."""
    row = (
        (
            await session.execute(
                text(
                    "SELECT id, tenant_id, tenant_name, email, role, expires_at, accepted_at, revoked_at "
                    "FROM lookup_invitation(:h)"
                ),
                {"h": _token_hash(token)},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise InvitationNotFoundError
    if row["revoked_at"] is not None:
        raise InvitationUnusableError("revoked")
    if row["accepted_at"] is not None:
        raise InvitationUnusableError("used")
    if row["expires_at"] <= datetime.now(UTC):
        raise InvitationUnusableError("expired")
    return InvitationPreview(
        id=row["id"],
        tenant_id=row["tenant_id"],
        tenant_name=row["tenant_name"],
        email=row["email"],
        role=row["role"],
        expires_at=row["expires_at"],
    )


async def accept_invitation(
    session: AsyncSession, preview: InvitationPreview, user_id: uuid.UUID
) -> None:
    """Join the tenant. The token authorized it, so the tenant context is set
    here (the caller has none yet) before touching RLS-protected rows."""
    await set_tenant_context(session, preview.tenant_id)
    if await verify_membership(session, user_id, preview.tenant_id) is None:
        session.add(
            TenantMembership(tenant_id=preview.tenant_id, user_id=user_id, role=preview.role)
        )
    result = await session.execute(select(Invitation).where(Invitation.id == preview.id))
    invitation = result.scalar_one()
    invitation.accepted_at = datetime.now(UTC)
    await session.flush()
