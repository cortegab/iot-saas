"""Auth routes: register, login, refresh, logout.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives in
auth/service.py and tenants/service.py.
"""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user
from app.auth.models import User
from app.auth.schemas import (
    AcceptInvitationRequest,
    ForgotPasswordRequest,
    InvitationPreviewResponse,
    LoginRequest,
    MembershipSummary,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenPairResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.config import settings
from app.db import get_session, set_user_context
from app.notifications.email import EmailMessage, send_after_commit
from app.redis import redis_client
from app.tenants import service as tenants_service

router = APIRouter(prefix="/auth", tags=["auth"])


async def _token_pair_response(
    session: AsyncSession, user_id: uuid.UUID, refresh_token: str
) -> TokenPairResponse:
    access_token = service.create_access_token(user_id)
    await set_user_context(session, user_id)
    memberships = await tenants_service.list_my_tenants(session, user_id)
    return TokenPairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        memberships=[
            MembershipSummary(
                tenant_id=tenant.id, tenant_name=tenant.name, tenant_slug=tenant.slug, role=role
            )
            for tenant, role in memberships
        ],
    )


@router.post("/register", response_model=TokenPairResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest, session: AsyncSession = Depends(get_session)
) -> TokenPairResponse:
    try:
        user, _tenant = await service.register_user(
            session, body.email, body.password, body.tenant_name, body.name
        )
    except service.EmailAlreadyRegisteredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from exc

    refresh_token = await service.issue_refresh_token(session, user.id)
    return await _token_pair_response(session, user.id, refresh_token)


@router.post("/login", response_model=TokenPairResponse)
async def login(
    body: LoginRequest, session: AsyncSession = Depends(get_session)
) -> TokenPairResponse:
    try:
        user = await service.authenticate_user(session, body.email, body.password)
    except service.InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        ) from exc

    refresh_token = await service.issue_refresh_token(session, user.id)
    return await _token_pair_response(session, user.id, refresh_token)


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(
    body: RefreshRequest, session: AsyncSession = Depends(get_session)
) -> TokenPairResponse:
    try:
        new_refresh_token, user_id = await service.rotate_refresh_token(session, body.refresh_token)
    except service.InvalidRefreshTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from exc

    return await _token_pair_response(session, user_id, new_refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, session: AsyncSession = Depends(get_session)) -> None:
    await service.revoke_refresh_token(session, body.refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        created_at=current_user.created_at,
    )


@router.get("/invitations/{token}", response_model=InvitationPreviewResponse)
async def preview_invitation(
    token: str, session: AsyncSession = Depends(get_session)
) -> InvitationPreviewResponse:
    """Public: what the invite link is for (no tenant context yet)."""
    preview = await _usable_invitation(session, token)
    return InvitationPreviewResponse(
        tenant_name=preview.tenant_name,
        email=preview.email,
        role=preview.role,
        expires_at=preview.expires_at,
        account_exists=await service.get_user_by_email(session, preview.email) is not None,
    )


@router.post("/invitations/{token}/accept", response_model=TokenPairResponse)
async def accept_invitation(
    token: str,
    body: AcceptInvitationRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> TokenPairResponse:
    """Join the invited workspace. A signed-in invitee (Bearer) must be the
    invited email; otherwise a new account is created from `name`/`password`
    — unless one already exists, in which case they must sign in first."""
    preview = await _usable_invitation(session, token)
    if authorization and authorization.startswith("Bearer "):
        try:
            user_id = service.decode_access_token(authorization.removeprefix("Bearer "))
        except service.InvalidAccessTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
            ) from exc
        people = await service.get_people_by_user_ids(session, [user_id])
        email = people.get(user_id, ("", None))[0]
        if email.lower() != preview.email.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This invitation is for {preview.email}. Sign in with that account.",
            )
    else:
        if not body.password:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Choose a password (at least 8 characters).",
            )
        try:
            user = await service.create_user(session, preview.email, body.password, body.name)
        except service.EmailAlreadyRegisteredError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already uses this email. Sign in to accept.",
            ) from exc
        user_id = user.id
    await tenants_service.accept_invitation(session, preview, user_id)
    refresh_token = await service.issue_refresh_token(session, user_id)
    return await _token_pair_response(session, user_id, refresh_token)


async def _usable_invitation(
    session: AsyncSession, token: str
) -> tenants_service.InvitationPreview:
    try:
        return await tenants_service.lookup_invitation(session, token)
    except tenants_service.InvitationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This invitation link isn't valid."
        ) from exc
    except tenants_service.InvitationUnusableError as exc:
        detail = {
            "expired": "This invitation has expired. Ask for a new one.",
            "revoked": "This invitation was cancelled.",
            "used": "This invitation was already accepted. Sign in instead.",
        }[exc.reason]
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=detail) from exc


# ---- forgot password ----------------------------------------------------------

_RESET_LIMIT = 3  # requests per email per window
_RESET_WINDOW_S = 15 * 60


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: ForgotPasswordRequest, session: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    """Always 202 with the same message — whether the email has an account is
    never revealed. At most a few emails per address per 15 minutes."""
    answer = {"detail": "If an account uses that email, a reset link is on its way."}
    key = f"auth:reset-rate:{body.email.strip().lower()}"
    count = int(await redis_client.get(key) or 0)
    if count >= _RESET_LIMIT:
        return answer
    await redis_client.set(key, str(count + 1), ex=_RESET_WINDOW_S)
    result = await service.request_password_reset(session, body.email)
    if result is not None:
        user, token = result
        send_after_commit(
            session,
            EmailMessage(
                to=[user.email],
                subject="Reset your password",
                body=(
                    "Someone (hopefully you) asked to reset your password.\n\n"
                    f"Choose a new one:\n{settings.app_base_url}/reset-password?token={token}\n\n"
                    "The link works once and expires in 30 minutes. If you didn't ask, ignore this email."
                ),
            ),
        )
    return answer


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordRequest, session: AsyncSession = Depends(get_session)
) -> None:
    try:
        await service.reset_password(session, body.token, body.password)
    except service.InvalidResetTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link isn't valid or has expired. Ask for a new one.",
        ) from exc


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    user = await service.update_profile(session, current_user, body.name)
    return UserResponse(id=user.id, email=user.email, name=user.name, created_at=user.created_at)
