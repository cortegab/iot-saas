"""Pydantic response models for the notifications routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID | None
    rule_id: uuid.UUID | None
    message: str
    created_at: datetime
    read_at: datetime | None
