"""SQLAlchemy models for tenants and tenant membership.

`tenants` itself is not tenant-scoped (it IS the tenant, tenant_id would be
circular) and is not RLS-protected — access is always gated by joining through
`tenant_memberships` in tenants/service.py. `tenant_memberships` is where
tenant isolation actually applies; see its migration for the dual-predicate RLS
policy (own rows via app.user_id, or all rows of the tenant in context via
app.tenant_id — needed because "list tenants I belong to" runs before any
tenant is selected).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TenantRole(str, enum.Enum):
    """A member's role within a tenant.

    Stored as plain text + a CHECK constraint (not a native Postgres ENUM) so
    adding a role later is a one-line migration rather than an ALTER TYPE.
    """

    OWNER = "owner"
    ADMIN = "admin"
    VIEWER = "viewer"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(nullable=False)
    slug: Mapped[str] = mapped_column(nullable=False, unique=True)
    # Recipient list for rule notification `email`-channel alerts, editable
    # from Settings -> Alerts. Empty ⇒ fall back to owner/admin member emails
    # (resolved in app.rules.service). Not a separate table — one small JSONB
    # list, same treatment dashboards.layout / catalog.metrics get.
    notification_emails: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    # IANA zone name: the default for new schedules and for showing times.
    timezone: Mapped[str] = mapped_column(nullable=False, server_default="UTC")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantMembership(Base):
    __tablename__ = "tenant_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_memberships_tenant_user"),
        CheckConstraint("role IN ('owner', 'admin', 'viewer')", name="ck_tenant_memberships_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invitation(Base):
    """An emailed, single-use invitation to join a tenant (see the
    a7d2e9c4b1f3 migration). Only a SHA-256 of the link token is stored."""

    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'viewer')", name="ck_invitations_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(nullable=False)
    role: Mapped[str] = mapped_column(nullable=False)
    token_hash: Mapped[str] = mapped_column(nullable=False, unique=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
