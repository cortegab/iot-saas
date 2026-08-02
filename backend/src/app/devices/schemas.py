"""Pydantic request/response models for the device routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.devices.models import DeviceStatus


class DeviceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class DeviceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    status: DeviceStatus | None = None


class DeviceResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class DeviceCredential(BaseModel):
    """The MQTT credential — present only in create/rotate responses, never in
    list/get responses. The password is shown once and cannot be retrieved again.
    """

    username: str
    password: str


class DeviceCreateResponse(BaseModel):
    device: DeviceResponse
    credential: DeviceCredential
