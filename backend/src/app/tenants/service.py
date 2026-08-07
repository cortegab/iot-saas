"""Tenant creation and membership queries."""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import service as catalog_service
from app.db import set_tenant_context
from app.tenants.models import Tenant, TenantMembership, TenantRole

LEGACY_CATALOG_ENTRY_NAME = "Legacy / Uncategorized"


class NotAMemberError(Exception):
    pass


class AlreadyAMemberError(Exception):
    pass


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return base or "tenant"


async def _unique_slug(session: AsyncSession, name: str) -> str:
    base = _slugify(name)
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


async def list_members(session: AsyncSession, tenant_id: uuid.UUID) -> list[tuple[uuid.UUID, str]]:
    """List (user_id, role) for every member of the tenant currently in context.

    Relies on tenant_memberships' RLS tenant_id branch — the caller must have
    already called set_tenant_context (tenants.deps.require_tenant_context does
    this). Returns no emails — enriching with email is the router's job, via
    auth.service.get_emails_by_user_ids, so this module never imports
    app.auth.models.User directly.
    """
    result = await session.execute(
        select(TenantMembership.user_id, TenantMembership.role).where(
            TenantMembership.tenant_id == tenant_id
        )
    )
    return [(user_id, role) for user_id, role in result.all()]


async def add_member(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, role: TenantRole
) -> None:
    if await verify_membership(session, user_id, tenant_id) is not None:
        raise AlreadyAMemberError
    session.add(TenantMembership(tenant_id=tenant_id, user_id=user_id, role=role.value))
    await session.flush()


async def change_role(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, role: TenantRole
) -> None:
    result = await session.execute(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise NotAMemberError
    membership.role = role.value
    await session.flush()


async def remove_member(session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> None:
    result = await session.execute(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise NotAMemberError
    await session.delete(membership)
    await session.flush()
