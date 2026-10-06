"""Dependency-injection providers for authenticated routes."""

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.models import User
from app.db import get_session, set_user_context


async def authenticate_access_token(token: str, session: AsyncSession) -> User:
    """A user's access token (JWT) → the active user, or 401. Shared with
    tenants.deps.require_tenant_context, which also accepts API keys."""
    try:
        user_id = service.decode_access_token(token)
    except service.InvalidAccessTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc

    # Set as soon as the request is authenticated, before any tenant is chosen —
    # required by tenant_memberships' RLS policy (its user_id branch) for any
    # "which tenants am I a member of" query later in this request.
    await set_user_context(session, user_id)

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive"
        )
    return user


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> User:
    """A signed-in person only — API keys are refused here (401), which is
    what keeps personal routes (dashboards, /auth/me, membership) key-free."""
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )
    return await authenticate_access_token(authorization.removeprefix("Bearer "), session)
