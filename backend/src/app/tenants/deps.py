"""Dependency-injection providers for tenant-scoped routes.

require_tenant_context is the single dependency every tenant-scoped route
relies on (devices, api_keys, tenant member management) — CLAUDE.md §7's
"never bypass the tenant-context dependency with a raw engine connection"
constraint lives or dies here.
"""

import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_session, set_tenant_context
from app.tenants import service
from app.tenants.models import TenantRole

_ROLE_RANK = {TenantRole.VIEWER: 0, TenantRole.ADMIN: 1, TenantRole.OWNER: 2}


@dataclass
class TenantContext:
    tenant_id: uuid.UUID
    role: TenantRole


async def require_tenant_context(
    x_tenant_id: str = Header(alias="X-Tenant-Id"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TenantContext:
    try:
        tenant_id = uuid.UUID(x_tenant_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="X-Tenant-Id must be a valid UUID"
        ) from exc

    role = await service.verify_membership(session, current_user.id, tenant_id)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant"
        )

    await set_tenant_context(session, tenant_id)
    return TenantContext(tenant_id=tenant_id, role=TenantRole(role))


def require_role(
    minimum: TenantRole,
) -> Callable[[TenantContext], Coroutine[Any, Any, TenantContext]]:
    async def _check(ctx: TenantContext = Depends(require_tenant_context)) -> TenantContext:
        if _ROLE_RANK[ctx.role] < _ROLE_RANK[minimum]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return ctx

    return _check
