"""Pydantic request/response models for the device routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.devices.models import DeviceStatus
from app.health.schemas import MetricHealthResponse

ConnectionState = Literal["online", "offline", "never_connected"]


class DeviceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Write-once — no reassignment endpoint exists. Defaults to the tenant's
    # auto-created "Legacy / Uncategorized" entry client-side when the user
    # hasn't defined any real catalog entries yet.
    catalog_entry_id: uuid.UUID


class DeviceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    status: DeviceStatus | None = None


class DeviceResponse(BaseModel):
    id: uuid.UUID
    name: str
    catalog_entry_id: uuid.UUID
    slug: str
    status: str
    last_seen_at: datetime | None
    created_at: datetime
    # Computed by devices/router.py's _to_response, preferring the push-driven
    # last_status_online (below) when present — an LWT-triggered False is
    # authoritative regardless of elapsed time — and otherwise falling back to
    # last_seen_at vs. settings.device_offline_after_seconds. The single
    # source of truth every "honest connection state" surface (list, detail,
    # dashboard widgets) reads from, so the threshold/fallback logic has
    # exactly one owner. The last_seen_at fallback is permanent, not a
    # migration-window shim — field firmware without status/LWT support can't
    # be force-upgraded.
    connection_state: ConnectionState
    # Tier A device-health snapshot (CLAUDE.md §4's {tenant}/{device}/status
    # topic) — all nullable, absent until the device sends its first status
    # message (pre-upgrade firmware may never send one).
    last_status_at: datetime | None
    rssi: int | None
    battery_pct: int | None
    uptime_s: int | None
    fw_version: str | None
    # Tier B per-metric freshness (app.health).
    metrics_health: list[MetricHealthResponse] = Field(default_factory=list)


class DeviceCredential(BaseModel):
    """The MQTT credential — present only in create/rotate responses, never in
    list/get responses. The password is shown once and cannot be retrieved again.
    """

    username: str
    password: str


class DeviceCreateResponse(BaseModel):
    device: DeviceResponse
    credential: DeviceCredential
    # Needed to build the MQTT topic ({tenant}/{device}/{metric}, CLAUDE.md
    # §4) for onboarding's generated firmware sketch — not on DeviceResponse
    # itself, since list/get views have no reason to carry it.
    tenant_slug: str
