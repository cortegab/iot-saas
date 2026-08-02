"""API key routes: create/list/revoke. CRUD-only this phase — see
api_keys/models.py's module docstring for why.

Thin per CLAUDE.md §6 — validation and delegation only.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api_keys import service
from app.api_keys.models import ApiKey
from app.api_keys.schemas import ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeyResponse
from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_session
from app.tenants.deps import TenantContext, require_role
from app.tenants.models import TenantRole

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _to_response(api_key: ApiKey) -> ApiKeyResponse:
    return ApiKeyResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        role=api_key.role,
        created_at=api_key.created_at,
        last_used_at=api_key.last_used_at,
        revoked_at=api_key.revoked_at,
    )


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> list[ApiKeyResponse]:
    keys = await service.list_api_keys(session, ctx.tenant_id)
    return [_to_response(k) for k in keys]


@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: ApiKeyCreateRequest,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApiKeyCreateResponse:
    api_key, full_key = await service.create_api_key(
        session, ctx.tenant_id, body.name, body.role, current_user.id
    )
    return ApiKeyCreateResponse(api_key=_to_response(api_key), key=full_key)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: uuid.UUID,
    ctx: TenantContext = Depends(require_role(TenantRole.ADMIN)),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await service.revoke_api_key(session, ctx.tenant_id, key_id)
    except service.ApiKeyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API key not found"
        ) from exc
