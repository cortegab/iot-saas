"""Tenant routes: list/create tenants, manage membership of the tenant
currently selected via X-Tenant-Id (see tenants/deps.py's require_tenant_context).

Thin per CLAUDE.md §6 — combines auth.service and tenants.service calls where a
route needs both (e.g. resolving an invite email, or attaching emails to a
member list), but no query logic of its own beyond that composition.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.auth.deps import get_current_user
from app.auth.models import User
from app.auth.schemas import MembershipSummary
from app.db import get_session, set_user_context
from app.tenants import service
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import Tenant, TenantRole
from app.tenants.schemas import (
    AddMemberRequest,
    ChangeRoleRequest,
    MemberResponse,
    TenantCreateRequest,
    TenantResponse,
    TenantUpdateRequest,
)

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _tenant_response(tenant: Tenant) -> TenantResponse:
    return TenantResponse(id=tenant.id, name=tenant.name, slug=tenant.slug, created_at=tenant.created_at)


@router.get("/mine", response_model=list[MembershipSummary])
async def list_mine(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MembershipSummary]:
    await set_user_context(session, current_user.id)
    memberships = await service.list_my_tenants(session, current_user.id)
    return [
        MembershipSummary(
            tenant_id=tenant.id, tenant_name=tenant.name, tenant_slug=tenant.slug, role=role
        )
        for tenant, role in memberships
    ]


@router.post("", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TenantResponse:
    tenant = await service.create_tenant_with_owner(
        session, user_id=current_user.id, name=body.name
    )
    return _tenant_response(tenant)


@router.get("/current", response_model=TenantResponse)
async def get_current_tenant(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> TenantResponse:
    tenant = await service.get_tenant(session, ctx.tenant_id)
    return _tenant_response(tenant)


@router.patch("/current", response_model=TenantResponse)
async def rename_current_tenant(
    body: TenantUpdateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.OWNER)),
    session: AsyncSession = Depends(get_session),
) -> TenantResponse:
    tenant = await service.rename_tenant(session, ctx.tenant_id, body.name)
    return _tenant_response(tenant)


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    ctx: TenantContext = Depends(require_tenant_context),
    session: AsyncSession = Depends(get_session),
) -> list[MemberResponse]:
    rows = await service.list_members(session, ctx.tenant_id)
    emails = await auth_service.get_emails_by_user_ids(session, [user_id for user_id, _ in rows])
    return [
        MemberResponse(user_id=user_id, email=emails.get(user_id, ""), role=role)
        for user_id, role in rows
    ]


@router.post("/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    body: AddMemberRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> MemberResponse:
    invitee = await auth_service.get_user_by_email(session, body.email)
    if invitee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No user registered with that email"
        )
    try:
        await service.add_member(session, ctx.tenant_id, invitee.id, body.role)
    except service.AlreadyAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Already a member of this tenant"
        ) from exc
    return MemberResponse(user_id=invitee.id, email=invitee.email, role=body.role.value)


@router.patch("/members/{user_id}", response_model=MemberResponse)
async def change_member_role(
    user_id: uuid.UUID,
    body: ChangeRoleRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> MemberResponse:
    try:
        await service.change_role(session, ctx.tenant_id, user_id, body.role)
    except service.NotAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this tenant"
        ) from exc
    emails = await auth_service.get_emails_by_user_ids(session, [user_id])
    return MemberResponse(user_id=user_id, email=emails.get(user_id, ""), role=body.role.value)


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await service.remove_member(session, ctx.tenant_id, user_id)
    except service.NotAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this tenant"
        ) from exc
