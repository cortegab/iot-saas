"""SQLAlchemy model for devices.

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see the
migration). Device credentials (MQTT username = slug, password = random secret)
follow the same argon2id split-secret pattern as refresh tokens and API keys —
see auth/service.py's hash_secret/verify_secret.

Note for Phase 2: EMQX's built-in Postgres-auth backend does not support
argon2 as a hash algorithm, so Phase 2 will likely need EMQX's HTTP auth
backend instead, calling back into the platform to verify token_hash. This
doesn't change anything about this schema.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DeviceStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_devices_tenant_slug"),
        CheckConstraint("status IN ('active', 'disabled')", name="ck_devices_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    slug: Mapped[str] = mapped_column(nullable=False)
    token_hash: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, default=DeviceStatus.ACTIVE.value)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
