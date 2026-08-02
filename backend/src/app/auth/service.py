"""Password/secret hashing, JWT issuance, and refresh-token lifecycle.

argon2id hashes are salted non-deterministically, so a secret can never be
looked up by its hash directly — hash_secret/verify_secret are reused by
devices/service.py and api_keys/service.py for exactly that reason: device
credentials and API keys both use the same split public-id/secret pattern as
refresh tokens here (CLAUDE.md constraint 12).
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exceptions
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.auth.models import RefreshToken, User
from app.config import settings
from app.tenants import service as tenants_service
from app.tenants.models import Tenant

_hasher = PasswordHasher()


class EmailAlreadyRegisteredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class InvalidAccessTokenError(Exception):
    pass


class InvalidRefreshTokenError(Exception):
    pass


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except (argon2_exceptions.VerifyMismatchError, argon2_exceptions.InvalidHashError):
        return False


# Device credentials and API keys use the identical mechanism — separate names
# make each call site read as what it means, not just how it's implemented.
hash_secret = hash_password
verify_secret = verify_password


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(
        payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_access_token(token: str) -> uuid.UUID:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key.get_secret_value(), algorithms=[settings.jwt_algorithm]
        )
    except jwt.InvalidTokenError as exc:
        raise InvalidAccessTokenError from exc

    if payload.get("type") != "access":
        raise InvalidAccessTokenError("not an access token")
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise InvalidAccessTokenError from exc


async def register_user(
    session: AsyncSession, email: str, password: str, tenant_name: str
) -> tuple[User, Tenant]:
    normalized_email = email.strip().lower()
    existing = await session.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none() is not None:
        raise EmailAlreadyRegisteredError(normalized_email)

    user = User(email=normalized_email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()  # populate user.id for the membership insert below

    tenant = await tenants_service.create_tenant_with_owner(
        session, user_id=user.id, name=tenant_name
    )
    return user, tenant


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User:
    normalized_email = email.strip().lower()
    result = await session.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    # Generic failure for both "no such user" and "wrong password" — no
    # enumeration signal either way.
    if user is None or not verify_password(password, user.password_hash):
        raise InvalidCredentialsError
    return user


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Used by tenants/router.py to resolve an invite email to a user id — kept
    here rather than in tenants/service.py so that module never queries `users`
    directly (CLAUDE.md §6: modules talk through service.py, never another
    module's models.py).
    """
    result = await session.execute(select(User).where(User.email == email.strip().lower()))
    return result.scalar_one_or_none()


async def get_emails_by_user_ids(
    session: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Used by tenants/router.py to enrich a membership list with emails,
    without tenants/service.py ever importing app.auth.models.User directly.
    """
    if not user_ids:
        return {}
    result = await session.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
    return {user_id: email for user_id, email in result.all()}


def _parse_refresh_token(raw: str) -> tuple[uuid.UUID, str]:
    try:
        id_part, secret = raw.split(".", 1)
        return uuid.UUID(id_part), secret
    except ValueError as exc:
        raise InvalidRefreshTokenError from exc


async def issue_refresh_token(
    session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID | None = None
) -> str:
    token_id = uuid.uuid4()
    secret = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex chars of randomness
    row = RefreshToken(
        id=token_id,
        user_id=user_id,
        token_hash=hash_secret(secret),
        family_id=family_id or uuid.uuid4(),
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days),
    )
    session.add(row)
    await session.flush()
    return f"{token_id}.{secret}"


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID, now: datetime) -> None:
    """Revoke every still-active token in a rotation family, committed on its own
    connection/transaction — independent of the caller's request-scoped session.

    This matters because rotate_refresh_token calls this right before raising
    InvalidRefreshTokenError. That exception propagates out through the request's
    session.begin() block (see app/db.py's get_session), which rolls back
    anything written on that session. The revocation below is the whole point of
    detecting reuse — it must survive regardless of how the request's own
    transaction ends. refresh_tokens has no RLS (see auth/models.py), so this
    isn't a tenant-context bypass; there is no RLS policy to bypass here.

    Uses session.bind (the exact AsyncEngine the session was constructed with,
    not a hardcoded import of app.db.engine) so this also does the right thing
    under the test suite's overridden get_session, which binds to a different
    engine (iot_test, not the dev database).
    """
    engine = session.bind
    # Sessions in this codebase are always created via async_sessionmaker(engine)
    # (see app/db.py and tests/conftest.py's client fixture) — never bound
    # directly to a Connection — so this is always an AsyncEngine in practice.
    assert isinstance(engine, AsyncEngine), "session must be bound to an AsyncEngine"
    async with engine.begin() as conn:
        await conn.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )


async def rotate_refresh_token(session: AsyncSession, raw_token: str) -> tuple[str, uuid.UUID]:
    """Verify and rotate a refresh token, detecting reuse of an already-rotated one.

    If the token was already rotated (revoked_at set) and is presented again,
    that's a replay — treat the whole rotation family as compromised and revoke
    it entirely, rather than just rejecting this one request.
    """
    token_id, secret = _parse_refresh_token(raw_token)
    result = await session.execute(select(RefreshToken).where(RefreshToken.id == token_id))
    row = result.scalar_one_or_none()
    if row is None or not verify_secret(secret, row.token_hash):
        raise InvalidRefreshTokenError

    now = datetime.now(UTC)
    if row.expires_at < now:
        raise InvalidRefreshTokenError

    if row.revoked_at is not None:
        await _revoke_family(session, row.family_id, now)
        raise InvalidRefreshTokenError

    row.revoked_at = now
    new_raw = await issue_refresh_token(session, row.user_id, family_id=row.family_id)
    return new_raw, row.user_id


async def revoke_refresh_token(session: AsyncSession, raw_token: str) -> None:
    """Idempotent: an already-revoked or garbage token is not an error."""
    try:
        token_id, secret = _parse_refresh_token(raw_token)
    except InvalidRefreshTokenError:
        return

    result = await session.execute(select(RefreshToken).where(RefreshToken.id == token_id))
    row = result.scalar_one_or_none()
    if row is None or not verify_secret(secret, row.token_hash):
        return
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
