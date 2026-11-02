"""SQLAlchemy model for dashboards.

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see
the migration) — same treatment every other small, uncompressed tenant-scoped
table gets (rules, commands, ...).

Dashboards are shared by everyone in the workspace (user decision
2026-11-02; who may change them by role is to be decided). `user_id` records
who created it and filters nothing. Where each person lands is their own
choice, on the membership (tenant_memberships.default_dashboard_id).

`user_id` is a plain FK to "users.id" — never importing app.auth.models.User
here (CLAUDE.md §6: modules don't import each other's models.py), the same
way Rule.device_id references "devices.id" without importing Device.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Dashboard(Base):
    __tablename__ = "dashboards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    # list[Widget-shaped dict] — see dashboards/schemas.py's Widget. Saved
    # wholesale on every drag/resize/add/remove, never patched incrementally.
    layout: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
