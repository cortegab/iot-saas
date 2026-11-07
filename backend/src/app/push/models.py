"""Phones that receive push notifications: one row per app install (its FCM
registration token) per workspace, owned by the user who signed in there.

Tenant-scoped with the standard RLS policy (CLAUDE.md §9.4). A token is unique
per tenant: the same phone signed in to two workspaces has two rows, and a
phone that changes hands moves to the new user on its next registration.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PushDevice(Base):
    __tablename__ = "push_devices"
    __table_args__ = (UniqueConstraint("tenant_id", "token", name="uq_push_devices_tenant_token"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # FCM registration token (opaque, ~160 chars).
    token: Mapped[str] = mapped_column(nullable=False)
    platform: Mapped[str] = mapped_column(nullable=False)
    # "critical": critical only; "warning": warnings and critical. Info never pushes.
    min_severity: Mapped[str] = mapped_column(nullable=False, server_default="warning")
    enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
