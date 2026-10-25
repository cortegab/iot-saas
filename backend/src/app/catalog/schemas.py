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
# How a template's devices run (DESIGN.md §8 "Runs on"): our generic firmware,
# wired by `hardware`, or the device's own code / a gateway (no wiring).
RunsOn = Literal["generic_firmware", "own_code"]
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


# Board model ids: firmware/boards.json's vocabulary (e.g. "esp32-devkit-30").
# Like driver ids, the list itself lives with the firmware release, so new
# boards need no backend change; the dashboard and the firmware check them.
_BOARD_ID = r"^[a-z0-9][a-z0-9-]{0,47}$"
# Driver ids: firmware/drivers.json's vocabulary.
_DRIVER_ID = r"^[a-z0-9_:]{1,64}$"


class HardwareBinding(BaseModel):
    """One sensor or actuator wired to the board, as the generic firmware reads
    it from its config blob (firmware/src/config.h): which driver, on which
    GPIOs, with which params, and which metric (or, for an output, which
    actuator) each of the driver's channels feeds.

    Only the shape and the channel → key mapping are checked here. Pin rules
    (ADC1, input-only, no sharing) and driver params belong to the driver
    catalog: the dashboard checks them before flashing, and the firmware
    refuses a config that breaks them.
    """

    driver: str = Field(pattern=_DRIVER_ID)
    pins: dict[str, int] = Field(default_factory=dict, max_length=8)
    params: dict[str, bool | int | float | str] = Field(default_factory=dict, max_length=16)
    channels: dict[str, str] = Field(default_factory=dict, max_length=16)


class I2cBus(BaseModel):
    sda: int = Field(ge=0, le=48)
    scl: int = Field(ge=0, le=48)


class HardwareConfig(BaseModel):
    """How a device is wired, for the generic firmware. A template carries the
    default; a device may carry its own (devices/schemas.py)."""

    board: str = Field(default="esp32-devkit-30", pattern=_BOARD_ID)
    i2c: I2cBus | None = None
    inputs: list[HardwareBinding] = Field(default_factory=list, max_length=32)
    outputs: list[HardwareBinding] = Field(default_factory=list, max_length=32)


class CatalogEntryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    metrics: list[CatalogMetric] = Field(default_factory=list)
    actuators: list[CatalogActuator] = Field(default_factory=list)
    hardware: HardwareConfig | None = None
    # Omitted: our firmware when wiring is given, own code otherwise.
    runs_on: RunsOn | None = None


class CatalogEntryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    metrics: list[CatalogMetric] | None = None
    actuators: list[CatalogActuator] | None = None
    status: CatalogEntryStatus | None = None
    # Explicit null clears the wiring; omitted leaves it unchanged.
    hardware: HardwareConfig | None = None
    runs_on: RunsOn | None = None


class KeyUsageResponse(BaseModel):
    rules: int
    widgets: int


class CatalogUsageResponse(BaseModel):
    """Per-key usage across the devices built from an entry — drives the
    editor's rename/remove warnings and key locks."""

    devices: int
    metrics: dict[str, KeyUsageResponse]
    actuators: dict[str, KeyUsageResponse]


class CatalogEntryResponse(BaseModel):
    id: uuid.UUID
    name: str
    metrics: list[CatalogMetric]
    actuators: list[CatalogActuator]
    hardware: HardwareConfig | None = None
    runs_on: RunsOn
    status: CatalogEntryStatus
    is_legacy: bool
    device_count: int
    created_at: datetime
    updated_at: datetime
