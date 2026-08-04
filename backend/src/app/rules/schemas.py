"""Pydantic request/response models for the rules routes.

`action` is a discriminated union on `type` — CLAUDE.md §5's rule schema
allows `actuator_command`, `notification`, and `webhook` actions.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

_OPERATOR_PATTERN = r"^(>|>=|<|<=|==|!=)$"


class ActuatorCommandAction(BaseModel):
    type: Literal["actuator_command"] = "actuator_command"
    actuator: str = Field(min_length=1, max_length=100)
    value: bool | float | str


class NotificationAction(BaseModel):
    type: Literal["notification"] = "notification"
    message: str = Field(min_length=1, max_length=1000)


class WebhookAction(BaseModel):
    type: Literal["webhook"] = "webhook"
    url: str = Field(min_length=1, max_length=2000)
    body: dict[str, object] = Field(default_factory=dict)


ActionRequest = Annotated[
    ActuatorCommandAction | NotificationAction | WebhookAction, Field(discriminator="type")
]


class RuleCreateRequest(BaseModel):
    metric: str = Field(min_length=1, max_length=100)
    operator: str = Field(pattern=_OPERATOR_PATTERN)
    threshold: float
    for_duration: int = Field(default=0, ge=0)
    hysteresis: float = Field(default=0.0, ge=0)
    cooldown: int = Field(default=0, ge=0)
    action: ActionRequest
    enabled: bool = True


class RuleUpdateRequest(BaseModel):
    metric: str | None = Field(default=None, min_length=1, max_length=100)
    operator: str | None = Field(default=None, pattern=_OPERATOR_PATTERN)
    threshold: float | None = None
    for_duration: int | None = Field(default=None, ge=0)
    hysteresis: float | None = Field(default=None, ge=0)
    cooldown: int | None = Field(default=None, ge=0)
    action: ActionRequest | None = None
    enabled: bool | None = None


class RuleResponse(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    metric: str
    type: str
    operator: str
    threshold: float
    for_duration: int
    hysteresis: float
    action: dict[str, object]
    cooldown: int
    enabled: bool
    created_at: datetime
