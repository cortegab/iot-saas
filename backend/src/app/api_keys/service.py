"""API key CRUD — create/list/revoke, hashed, shown once at creation.

CRUD-only this phase — see api_keys/models.py's module docstring for why.
"""

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api_keys.models import ApiKey
from app.auth import service as auth_service
from app.tenants.models import TenantRole


class ApiKeyNotFoundError(Exception):
    pass


def _generate_key() -> tuple[str, str, str]:
    """Returns (full_key, key_prefix, secret). full_key is shown once; key_prefix
    is safe to display later (e.g. "iot_a1b2c3_x9y8z7") to help identify a key
    without exposing the secret.
    """
    key_id = uuid.uuid4().hex[:12]
    secret = secrets.token_urlsafe(32)
    full_key = f"iot_{key_id}_{secret}"
    key_prefix = f"iot_{key_id}_{secret[:6]}"
    return full_key, key_prefix, secret


async def create_api_key(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    name: str,
    role: TenantRole,
    created_by: uuid.UUID,
) -> tuple[ApiKey, str]:
    full_key, key_prefix, secret = _generate_key()
    api_key = ApiKey(
        tenant_id=tenant_id,
        name=name,
        key_prefix=key_prefix,
        key_hash=auth_service.hash_secret(secret),
        role=role.value,
        created_by=created_by,
    )
    session.add(api_key)
    await session.flush()
    return api_key, full_key


async def list_api_keys(session: AsyncSession, tenant_id: uuid.UUID) -> list[ApiKey]:
    result = await session.execute(select(ApiKey).where(ApiKey.tenant_id == tenant_id))
    return list(result.scalars().all())


async def revoke_api_key(session: AsyncSession, tenant_id: uuid.UUID, key_id: uuid.UUID) -> None:
    result = await session.execute(
        select(ApiKey).where(ApiKey.tenant_id == tenant_id, ApiKey.id == key_id)
    )
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise ApiKeyNotFoundError
    if api_key.revoked_at is None:
        api_key.revoked_at = datetime.now(UTC)
        await session.flush()
