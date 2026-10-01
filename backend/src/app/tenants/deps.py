"""Dependency-injection providers for tenant-scoped routes.

require_tenant_context is the single dependency every tenant-scoped route
relies on (devices, api_keys, tenant member management) — CLAUDE.md §7's
"never bypass the tenant-context dependency with a raw engine connection"
constraint lives or dies here.

Two credentials reach it, both as `Authorization: Bearer …`:
- a user's access token (JWT) plus `X-Tenant-Id`, checked against the
  user's memberships;
- an API key (`iot_…`), which names its own tenant. `X-Tenant-Id` is
  optional and must match when sent. The key's role (Viewer or Admin) is
  the ceiling for the request.
"""

import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api_keys import service as api_keys_service
from app.auth.deps import authenticate_access_token
from app.db import get_session, set_tenant_context
from app.tenants import service
from app.tenants.models import TenantRole

_ROLE_RANK = {TenantRole.VIEWER: 0, TenantRole.ADMIN: 1, TenantRole.OWNER: 2}


@dataclass
class TenantContext:
    tenant_id: uuid.UUID
    role: TenantRole
    # Exactly one of these is set: who is calling.
    user_id: uuid.UUID | None = None
    api_key_id: uuid.UUID | None = None


def _parse_tenant_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="X-Tenant-Id must be a valid UUID"
        ) from exc


async def require_tenant_context(
    authorization: str | None = Header(default=None),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    session: AsyncSession = Depends(get_session),
) -> TenantContext:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )
    token = authorization.removeprefix("Bearer ")

    if api_keys_service.looks_like_api_key(token):
        try:
            principal = await api_keys_service.authenticate_api_key(session, token)
        except api_keys_service.ApiKeyAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid, expired or revoked API key",
            ) from exc
        if x_tenant_id is not None and _parse_tenant_id(x_tenant_id) != principal.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This API key belongs to another tenant",
            )
        await set_tenant_context(session, principal.tenant_id)
        await api_keys_service.touch_last_used(session, principal.key_id)
        return TenantContext(
            tenant_id=principal.tenant_id, role=principal.role, api_key_id=principal.key_id
        )

    user = await authenticate_access_token(token, session)
    if x_tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="X-Tenant-Id header is required",
        )
    tenant_id = _parse_tenant_id(x_tenant_id)

    role = await service.verify_membership(session, user.id, tenant_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant"
        )

    await set_tenant_context(session, tenant_id)
    return TenantContext(tenant_id=tenant_id, role=TenantRole(role), user_id=user.id)


def require_role(
    minimum: TenantRole,
    *,
    people_only: bool = False,
) -> Callable[[TenantContext], Coroutine[Any, Any, TenantContext]]:
    """`people_only` refuses API keys: managing members and keys themselves
    always needs a signed-in person."""

    async def _check(ctx: TenantContext = Depends(require_tenant_context)) -> TenantContext:
        if people_only and ctx.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="API keys can't do this"
            )
        if _ROLE_RANK[ctx.role] < _ROLE_RANK[minimum]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return ctx

    return _check
