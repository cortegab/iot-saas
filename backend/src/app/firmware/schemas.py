"""Over-the-air firmware updates (generic firmware 1.0.0+, docs/firmware/ota.md)."""

from datetime import datetime

from pydantic import BaseModel, Field


class OtaState(BaseModel):
    """An update's progress as the device last reported it in its status
    message (firmware/src/ota.h)."""

    version: str
    state: str  # downloading | restarting | failed | rolled_back
    error: str | None = None


class FirmwareStatusResponse(BaseModel):
    """What the device runs, the latest release, and whether it can update to
    it over the air right now (`reason` says why not, in words)."""

    current: str | None
    latest: str | None
    update_available: bool
    can_update: bool
    reason: str | None
    # The version last requested, when, and the device's report on it.
    target: str | None
    requested_at: datetime | None
    state: OtaState | None


class FirmwareUpdateRequest(BaseModel):
    version: str = Field(min_length=1, max_length=32)
