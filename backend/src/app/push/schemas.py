import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["android", "ios"]
MinSeverity = Literal["critical", "warning"]


class PushDeviceRegisterRequest(BaseModel):
    """Called by the app after sign-in and whenever FCM hands it a new token.
    Registering the same token again updates it (and its owner) instead of
    adding a row."""

    token: str = Field(min_length=20, max_length=4096)
    platform: Platform
    min_severity: MinSeverity | None = None
    enabled: bool | None = None


class PushDeviceUpdateRequest(BaseModel):
    min_severity: MinSeverity | None = None
    enabled: bool | None = None


class PushDeviceResponse(BaseModel):
    id: uuid.UUID
    platform: Platform
    min_severity: MinSeverity
    enabled: bool
    created_at: datetime
    last_seen_at: datetime
