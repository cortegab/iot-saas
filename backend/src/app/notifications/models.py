"""SQLAlchemy model for notifications — a tenant-wide activity feed of rule
firings, regardless of the rule's configured action type.

Tenant-scoped, standard RLS (low volume, never compressed — same treatment
`commands`/`rules` get). Read/unread state is shared across the tenant, not
per-user: rules are tenant+device resources with no user attached, and unlike
`dashboards` (deliberately per-user — see its own module docstring for why),
there's no existing precedent for per-user state here. Whoever reads a
notification, it's read for the whole tenant.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    # Nullable + SET NULL: a notification should survive its device/rule being
    # deleted — same treatment commands.rule_id already gets.
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rules.id", ondelete="SET NULL"), nullable=True
    )
    message: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
