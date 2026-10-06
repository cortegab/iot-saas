"""API keys — create/list/revoke (hashed, shown once at creation) and the
authentication path that turns a presented key into a tenant + role.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api_keys.models import ApiKey
from app.auth import service as auth_service
from app.tenants.models import TenantRole

KEY_PREFIX = "iot_"
# last_used_at is a hint for humans ("used 4 min ago"), not an audit log —
# writing it on every request would turn every read into a write.
LAST_USED_RESOLUTION = timedelta(minutes=5)


class ApiKeyNotFoundError(Exception):
    pass


class ApiKeyAuthError(Exception):
    """The presented key is malformed, unknown, wrong, revoked or expired.
    Deliberately one error: the caller says the same thing for all of them."""


@dataclass(frozen=True)
class ApiKeyPrincipal:
    key_id: uuid.UUID
    tenant_id: uuid.UUID
    role: TenantRole


def looks_like_api_key(token: str) -> bool:
    return token.startswith(KEY_PREFIX)


def _generate_key() -> tuple[str, str, str]:
    """Returns (full_key, key_prefix, secret). full_key is shown once; key_prefix
    is safe to display later (e.g. "iot_a1b2c3_x9y8z7") to help identify a key
    without exposing the secret.
    """
    key_id = uuid.uuid4().hex[:12]
    secret = secrets.token_urlsafe(32)
    full_key = f"{KEY_PREFIX}{key_id}_{secret}"
    key_prefix = f"{KEY_PREFIX}{key_id}_{secret[:6]}"
    return full_key, key_prefix, secret


async def create_api_key(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    name: str,
    role: TenantRole,
    created_by: uuid.UUID,
    expires_in_days: int | None = None,
) -> tuple[ApiKey, str]:
    full_key, key_prefix, secret = _generate_key()
    api_key = ApiKey(
        tenant_id=tenant_id,
        name=name,
        key_prefix=key_prefix,
        key_hash=auth_service.hash_secret(secret),
        role=role.value,
        created_by=created_by,
        expires_at=(
            datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
        ),
    )
    session.add(api_key)
    await session.flush()
    await session.refresh(api_key)
    return api_key, full_key


async def list_api_keys(session: AsyncSession, tenant_id: uuid.UUID) -> list[ApiKey]:
    result = await session.execute(
        select(ApiKey).where(ApiKey.tenant_id == tenant_id).order_by(ApiKey.created_at.desc())
    )
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


async def authenticate_api_key(session: AsyncSession, presented: str) -> ApiKeyPrincipal:
    """Resolve `iot_{key_id}_{secret}` to its tenant and role.

    The lookup runs through the `lookup_api_key` SECURITY DEFINER function
    because there is no tenant context yet; only after the secret verifies
    does the caller set one. Owner-role keys (created before keys could only
    be Viewer/Admin) are refused rather than silently downgraded.
    """
    parts = presented.removeprefix(KEY_PREFIX).split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ApiKeyAuthError
    key_id, secret = parts
    row = (
        (
            await session.execute(
                text(
                    "SELECT id, tenant_id, key_hash, role, expires_at, revoked_at, last_used_at "
                    "FROM lookup_api_key(:key_id)"
                ),
                {"key_id": key_id},
            )
        )
        .mappings()
        .first()
    )
    if row is None or not auth_service.verify_secret(secret, row["key_hash"]):
        raise ApiKeyAuthError
    now = datetime.now(UTC)
    if row["revoked_at"] is not None or (
        row["expires_at"] is not None and row["expires_at"] <= now
    ):
        raise ApiKeyAuthError
    if row["role"] not in (TenantRole.VIEWER.value, TenantRole.ADMIN.value):
        raise ApiKeyAuthError
    return ApiKeyPrincipal(
        key_id=row["id"], tenant_id=row["tenant_id"], role=TenantRole(row["role"])
    )


async def touch_last_used(session: AsyncSession, key_id: uuid.UUID) -> None:
    """Throttled: only writes when the stored value is older than the
    resolution. Call with the tenant context already set (RLS)."""
    now = datetime.now(UTC)
    await session.execute(
        update(ApiKey)
        .where(
            ApiKey.id == key_id,
            (ApiKey.last_used_at.is_(None)) | (ApiKey.last_used_at < now - LAST_USED_RESOLUTION),
        )
        .values(last_used_at=now)
    )
