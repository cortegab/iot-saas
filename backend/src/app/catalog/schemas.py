"""Pydantic request/response models for the device-catalog routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Informational only for now — telemetry's `value` column is always a bare
# float regardless of what a catalog entry declares (ingestion/schemas.py);
# this doesn't change wire validation, only what authoring UIs display.
# "bool" marks an on/off flag metric (door open, leak detected): still a
# 0.0/1.0 float on the wire, but authoring/display can treat it as two-state.
MetricDataType = Literal["float", "bool"]
ActuatorValueType = Literal["bool", "float", "string"]
CatalogEntryStatus = Literal["active", "disabled"]
# "periodic": device publishes on a fixed interval (the default — matches
# today's implicit behavior). "on_change": device publishes only when the
# value moves past `publish_deadband`. "streaming": device publishes as fast
# as it samples. The platform stores/distributes this; the device enforces
# it locally (CLAUDE.md's hot-path rule means the platform never throttles
# inbound telemetry itself).
PublishProfile = Literal["periodic", "on_change", "streaming"]

# Wire-format metric keys reserved for the device-health contract (see
# ingestion/service.py's RESERVED_METRIC_STATUS) — a tenant-authored metric
# can never collide with the `.../status` or `.../config` topics.
RESERVED_METRIC_KEYS = {"status", "config"}


class CatalogMetric(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Wire-format identifier distinct from the display `name` (e.g. `temperature`
    # vs. "Temperature") — nullable so pre-existing entries without one still
    # validate; authoring UIs should default it from `name` going forward.
    key: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=32)
    data_type: MetricDataType = "float"
    decimals: int | None = Field(default=None, ge=0, le=10)
    min: float | None = None
    max: float | None = None
    publish: PublishProfile = "periodic"
    # Meaningful for "periodic"/"streaming" — the interval the device should
    # enforce locally. Unset means the device's own firmware default applies.
    publish_interval_seconds: int | None = Field(default=None, gt=0)
    # Meaningful only for "on_change" — minimum delta before republishing.
    publish_deadband: float | None = Field(default=None, ge=0)


class CatalogActuator(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    key: str | None = Field(default=None, max_length=100)
    value_type: ActuatorValueType = "bool"
    # Nullable — only enum-like actuators (e.g. a 3-position valve) declare this.
    allowed_values: list[bool | float | str] | None = None
    # Command-value mapping for bool actuators (spec's "ON -> 1", "OFF -> 0")
    # — what value_type="bool" true/false actually publish on the wire.
    # Unset for non-bool actuators.
    on_value: bool | float | str | None = None
    off_value: bool | float | str | None = None


class CatalogEntryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    metrics: list[CatalogMetric] = Field(default_factory=list)
    actuators: list[CatalogActuator] = Field(default_factory=list)


class CatalogEntryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    metrics: list[CatalogMetric] | None = None
    actuators: list[CatalogActuator] | None = None
    status: CatalogEntryStatus | None = None


class CatalogEntryResponse(BaseModel):
    id: uuid.UUID
    name: str
    metrics: list[CatalogMetric]
    actuators: list[CatalogActuator]
    status: CatalogEntryStatus
    is_legacy: bool
    device_count: int
    created_at: datetime
    updated_at: datetime
