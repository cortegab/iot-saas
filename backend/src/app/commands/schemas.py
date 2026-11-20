"""Pydantic models for the commands (audit log) routes and the ack payload
device firmware publishes on {tenant}/{device}/ack/{actuator} (CLAUDE.md §4).
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.shared.topics import TOPIC_SEGMENT_PATTERN


class ManualCommandRequest(BaseModel):
    """A dashboard-triggered actuator toggle (Phase 4) — validated the same
    as any other HTTP boundary input before commands.service.request_manual_command
    ever sees it.
    """

    actuator: str = Field(min_length=1, max_length=100, pattern=TOPIC_SEGMENT_PATTERN)
    value: bool | float | str


class AckPayload(BaseModel):
    """Untrusted device input (CLAUDE.md §7) — validated before
    commands.service.record_ack ever sees it."""

    command_id: uuid.UUID


class CommandResponse(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    rule_id: uuid.UUID | None
    actuator: str
    value: object
    issued_at: datetime
    ttl_seconds: int
    published_at: datetime
    acked_at: datetime | None
    # Set once the TTL passed with no ack ("No response").
    expired_at: datetime | None = None
    # Who sent a manual command; null for a rule's.
    requested_by: uuid.UUID | None = None
    latency_ms: float
