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
from app.config import settings
from app.db import get_session, set_user_context
from app.notifications.email import EmailMessage, send_after_commit
from app.tenants import service
from app.tenants.deps import TenantContext, require_role, require_tenant_context
from app.tenants.models import Invitation, Tenant, TenantRole
from app.tenants.schemas import (
    AddMemberRequest,
    ChangeRoleRequest,
    InvitationCreateRequest,
    InvitationResponse,
    MemberResponse,
    TenantCreateRequest,
    TenantResponse,
    TenantUpdateRequest,
)

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _tenant_response(tenant: Tenant) -> TenantResponse:
    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        notification_emails=list(tenant.notification_emails),
        timezone=tenant.timezone,
        created_at=tenant.created_at,
    )


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
async def update_current_tenant(
    body: TenantUpdateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> TenantResponse:
    # Admins manage alert recipients and the time zone; renaming the
    # workspace stays with owners (DESIGN.md §8).
    if body.name is not None and ctx.role != TenantRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an owner can rename the workspace",
        )
    tenant = await service.update_tenant(
        session,
        ctx.tenant_id,
        name=body.name,
        notification_emails=body.notification_emails,
        timezone=body.timezone,
    )
    return _tenant_response(tenant)


def _escalation() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only an owner can grant, change or remove the Owner role.",
    )


def _last_owner() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="A workspace needs at least one owner. Make someone else an owner first.",
    )


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    ctx: TenantContext = Depends(require_role(TenantRole.VIEWER, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> list[MemberResponse]:
    rows = await service.list_members(session, ctx.tenant_id)
    people = await auth_service.get_people_by_user_ids(session, [user_id for user_id, _, _ in rows])
    return [
        MemberResponse(
            user_id=user_id,
            email=people.get(user_id, ("", None))[0],
            name=people.get(user_id, ("", None))[1],
            role=role,
            joined_at=joined,
        )
        for user_id, role, joined in rows
    ]


@router.post("/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    body: AddMemberRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> MemberResponse:
    try:
        service.assert_can_assign(ctx.role.value, body.role)
    except service.RoleEscalationError as exc:
        raise _escalation() from exc
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
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> MemberResponse:
    try:
        await service.change_role(session, ctx.tenant_id, user_id, body.role, ctx.role.value)
    except service.NotAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this tenant"
        ) from exc
    except service.RoleEscalationError as exc:
        raise _escalation() from exc
    except service.LastOwnerError as exc:
        raise _last_owner() from exc
    emails = await auth_service.get_emails_by_user_ids(session, [user_id])
    return MemberResponse(user_id=user_id, email=emails.get(user_id, ""), role=body.role.value)


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await service.remove_member(session, ctx.tenant_id, user_id, ctx.role.value)
    except service.NotAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this tenant"
        ) from exc
    except service.RoleEscalationError as exc:
        raise _escalation() from exc
    except service.LastOwnerError as exc:
        raise _last_owner() from exc


@router.post("/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_tenant(
    ctx: TenantContext = Depends(require_tenant_context),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Any member can leave; the last owner can't."""
    try:
        await service.remove_member(session, ctx.tenant_id, current_user.id, ctx.role.value)
    except service.LastOwnerError as exc:
        raise _last_owner() from exc


# ---- invitations -------------------------------------------------------------


def _invitation_response(inv: Invitation) -> InvitationResponse:
    return InvitationResponse(
        id=inv.id,
        email=inv.email,
        role=inv.role,
        created_at=inv.created_at,
        expires_at=inv.expires_at,
    )


async def _send_invitation(
    session: AsyncSession, tenant_id: uuid.UUID, inviter: User, email: str, role: str, token: str
) -> None:
    tenant = await service.get_tenant(session, tenant_id)
    who = inviter.name or inviter.email
    send_after_commit(
        session,
        EmailMessage(
            to=[email],
            subject=f"{who} invited you to {tenant.name}",
            body=(
                f"{who} invited you to join {tenant.name} as {role}.\n\n"
                f"Accept the invitation:\n{settings.app_base_url}/invite/{token}\n\n"
                "The link works once and expires in 7 days."
            ),
        ),
    )


@router.get("/invitations", response_model=list[InvitationResponse])
async def list_invitations(
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> list[InvitationResponse]:
    return [_invitation_response(i) for i in await service.list_invitations(session, ctx.tenant_id)]


@router.post("/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    body: InvitationCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationResponse:
    try:
        service.assert_can_assign(ctx.role.value, body.role)
    except service.RoleEscalationError as exc:
        raise _escalation() from exc
    existing = await auth_service.get_user_by_email(session, body.email)
    members = {user_id for user_id, _, _ in await service.list_members(session, ctx.tenant_id)}
    try:
        invitation, token = await service.create_invitation(
            session,
            ctx.tenant_id,
            body.email,
            body.role,
            invited_by=current_user.id,
            existing_member_ids=members,
            invitee_id=existing.id if existing else None,
        )
    except service.AlreadyAMemberError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Already a member of this workspace"
        ) from exc
    except service.AlreadyInvitedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There's already a pending invitation for this email. Resend it instead.",
        ) from exc
    await _send_invitation(
        session, ctx.tenant_id, current_user, invitation.email, invitation.role, token
    )
    await session.refresh(invitation)
    return _invitation_response(invitation)


@router.post("/invitations/{invitation_id}/resend", response_model=InvitationResponse)
async def resend_invitation(
    invitation_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationResponse:
    try:
        invitation = await service.get_invitation(session, ctx.tenant_id, invitation_id)
    except service.InvitationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found"
        ) from exc
    token = await service.renew_invitation(session, invitation)
    await _send_invitation(
        session, ctx.tenant_id, current_user, invitation.email, invitation.role, token
    )
    return _invitation_response(invitation)


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invitation(
    invitation_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN, people_only=True)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        invitation = await service.get_invitation(session, ctx.tenant_id, invitation_id)
    except service.InvitationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found"
        ) from exc
    await service.revoke_invitation(session, invitation)
