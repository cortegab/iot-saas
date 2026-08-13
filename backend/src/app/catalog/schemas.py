"""Pydantic request/response models for the device-catalog routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Informational only for now — telemetry's `value` column is always a bare
# float regardless of what a catalog entry declares (ingestion/schemas.py);
# this doesn't change wire validation, only what authoring UIs display.
MetricDataType = Literal["float"]
ActuatorValueType = Literal["bool", "float", "string"]
CatalogEntryStatus = Literal["active", "disabled"]


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
