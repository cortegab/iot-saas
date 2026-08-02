"""SQLAlchemy models for users and refresh tokens.

`users` is global — not owned by any single tenant, since a user can belong to
many (CLAUDE.md: many-to-many membership). It has no tenant_id and is not
RLS-protected; every route that touches it filters explicitly by the
authenticated caller's own id in auth/service.py. There is no "list all users"
endpoint in Phase 1, so there is no enumeration surface this would need to guard.

`refresh_tokens` belongs to a user, not a tenant — a login session isn't
tenant-specific in this design (tenant is chosen per-request via X-Tenant-Id,
not baked into the token). No tenant_id, no RLS; scoped by user_id in
auth/service.py.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RefreshToken(Base):
    """DB-backed, revocable refresh token (split id/secret — see auth/service.py's
    hash_secret/verify_secret). `family_id` groups a token's full rotation chain
    so reuse of an already-rotated token (replay) can revoke the whole chain.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
