"""Auth routes: register, login, refresh, logout.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives in
auth/service.py and tenants/service.py.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.schemas import (
    LoginRequest,
    MembershipSummary,
    RefreshRequest,
    RegisterRequest,
    TokenPairResponse,
)
from app.db import get_session, set_user_context
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
            MembershipSummary(tenant_id=tenant.id, tenant_name=tenant.name, role=role)
            for tenant, role in memberships
        ],
    )


@router.post("/register", response_model=TokenPairResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest, session: AsyncSession = Depends(get_session)
) -> TokenPairResponse:
    try:
        user, _tenant = await service.register_user(
            session, body.email, body.password, body.tenant_name
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
