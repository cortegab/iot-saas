"""SQLAlchemy model for API keys.

Tenant-scoped, CRUD-only in this phase — PLAN.md's Phase 1 milestone doesn't
require key-based authentication to work end-to-end, and there's no real
consumer for it until a later phase, so create/list/revoke is all that's built
here. Wiring `Authorization: ApiKey <key>` into tenants.deps.require_tenant_context
as an alternate credential path is the documented follow-up.

Uses the same split public-id/secret + argon2id pattern as devices/refresh
tokens (see auth/service.py's hash_secret/verify_secret).
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ApiKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'viewer')", name="ck_api_keys_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    key_prefix: Mapped[str] = mapped_column(nullable=False)
    key_hash: Mapped[str] = mapped_column(nullable=False)
    role: Mapped[str] = mapped_column(nullable=False)
    # The key survives its creator's account being removed — it belongs to the
    # tenant, not the user who happened to create it.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
