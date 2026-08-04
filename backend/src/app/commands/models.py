"""SQLAlchemy model for commands — the actuator command audit log.

`id` doubles as the `command_id` carried in the MQTT command payload
(CLAUDE.md §4). Tenant-scoped, standard RLS (low volume, never compressed —
no conflict with `telemetry`'s RLS/compression tradeoff).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Command(Base):
    __tablename__ = "commands"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    # Nullable: every command in Phase 3 comes from a rule firing, but a future
    # manual-trigger path (Phase 4 dashboard) can reuse this table without a
    # rule behind it.
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rules.id", ondelete="SET NULL"), nullable=True
    )
    actuator: Mapped[str] = mapped_column(nullable=False)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ttl_seconds: Mapped[int] = mapped_column(nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Breach reading timestamp -> publish, per CLAUDE.md's "latency
    # instrumentation: record breach->publish for every firing."
    latency_ms: Mapped[float] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
