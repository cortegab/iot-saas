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


# The summary's types: what a person scans for, so a rule firing and its
# clearing count together as "rules".
NotificationType = Literal[
    "rules", "rule_health", "device_offline", "delivery_failed", "template_changed"
]
KIND_TYPE: dict[str, NotificationType] = {
    "rule_fired": "rules",
    "rule_cleared": "rules",
    "rule_health": "rule_health",
    "device_offline": "device_offline",
    "delivery_failed": "delivery_failed",
    "template_changed": "template_changed",
}


class NotificationGroupResponse(BaseModel):
    """Repeats of one alert from one source (same kind, rule, device, template
    and message), as one row. `key` names the group in the group routes."""

    key: str
    latest: NotificationResponse
    count: int
    unread_count: int
    first_at: datetime
    last_at: datetime


class NotificationSummaryResponse(BaseModel):
    """Counts for the page's state filter, in alerts (groups), not
    notifications; and the devices and rules that have any, for its filters."""

    alerts: int
    unread: int
    unread_by_type: dict[NotificationType, int]
    device_ids: list[uuid.UUID]
    rule_ids: list[uuid.UUID]


class NotificationIdsRequest(BaseModel):
    ids: list[uuid.UUID]
