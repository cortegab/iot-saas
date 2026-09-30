"""Pydantic request/response models for the zone routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ZoneCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=1000)


class ZoneUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=1000)


class ZoneResponse(BaseModel):
    id: uuid.UUID
    name: str
    notes: str | None
    device_count: int
    created_at: datetime
    updated_at: datetime
