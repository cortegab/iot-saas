"""SQLAlchemy model for per-(device, metric) freshness — Tier B of device
health (see devices/models.py's Device columns for Tier A, the coarser
device-level scalar snapshot).

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see
the migration). A separate module from `devices` — both `devices` (API
surface, DeviceResponse.metrics_health) and `rules`/`worker`
(health_monitor_loop's staleness-threshold derivation) need this data, so per
CLAUDE.md §6 it gets its own module rather than living in either.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DeviceMetricHealth(Base):
    __tablename__ = "device_metric_health"
    __table_args__ = (
        UniqueConstraint("device_id", "metric", name="uq_device_metric_health_device_metric"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    metric: Mapped[str] = mapped_column(String, nullable=False)
    last_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
