"""Pydantic response models for the notifications routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Severity = Literal["info", "warning", "critical"]
NotificationKind = Literal[
    "rule_fired",
    "rule_cleared",
    "rule_health",
    "device_offline",
    "delivery_failed",
    "template_changed",
]


class NotificationResponse(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID | None
    rule_id: uuid.UUID | None
    catalog_entry_id: uuid.UUID | None
    message: str
    detail: str | None
    severity: Severity
    kind: NotificationKind
    created_at: datetime
    read_at: datetime | None
    dismissed_at: datetime | None
