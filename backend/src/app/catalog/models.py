"""SQLAlchemy model for device catalog entries — tenant-defined device
"types" that a device instantiates from and inherits definitions from: named
metrics (unit/data type/range) and named actuators (value type/allowed
values).

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see
the migration) — same treatment as rules/commands/dashboards. Not per-user
(unlike dashboards) — a catalog entry is tenant configuration, the same trust
tier as a device or a rule, not a personal view.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DeviceCatalogEntry(Base):
    __tablename__ = "device_catalog_entries"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'disabled')", name="ck_device_catalog_entries_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    # list[{"name", "key", "unit", "data_type", "decimals", "min", "max"}] — see
    # catalog/schemas.py's CatalogMetric.
    metrics: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # list[{"name", "key", "value_type", "allowed_values", "on_value", "off_value"}]
    # — see catalog/schemas.py's CatalogActuator.
    actuators: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # "active" | "disabled" — a disabled type stays intact (existing devices
    # keep working) but shouldn't be offered when creating a new device.
    status: Mapped[str] = mapped_column(nullable=False, default="active")
    # True only for the migration-created "Legacy / Uncategorized" backfill
    # entry — lets the UI flag pre-catalog devices without a separate table.
    is_legacy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
