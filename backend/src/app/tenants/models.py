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
