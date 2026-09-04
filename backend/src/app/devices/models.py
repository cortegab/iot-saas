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
    # No ON DELETE clause (RESTRICT by default) — a catalog entry still
    # referenced by a device can't be deleted (catalog/service.py's
    # CatalogEntryInUseError). Write-once: chosen at creation, never
    # reassigned, matching slug's immutability below.
    catalog_entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("device_catalog_entries.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    slug: Mapped[str] = mapped_column(nullable=False)
    token_hash: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, default=DeviceStatus.ACTIVE.value)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Tier A device-health snapshot — written synchronously from a retained
    # {tenant}/{device}/status message (app.worker._handle_status), not
    # batched like last_seen_at above. `last_status_online` is push-driven and
    # authoritative when present (an LWT-triggered False means offline, full
    # stop); devices/router.py's _connection_state prefers it over the
    # last_seen_at heuristic, falling back for devices that have never sent a
    # status message (older firmware — this fallback is permanent, not a
    # migration window).
    last_status_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status_online: Mapped[bool | None] = mapped_column(nullable=True)
    rssi: Mapped[int | None] = mapped_column(nullable=True)
    battery_pct: Mapped[int | None] = mapped_column(nullable=True)
    uptime_s: Mapped[int | None] = mapped_column(nullable=True)
    fw_version: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
