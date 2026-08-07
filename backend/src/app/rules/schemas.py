"""Pydantic request/response models for the rules routes.

`action` is a discriminated union on `type` — CLAUDE.md §5's rule schema
allows `actuator_command`, `notification`, and `webhook` actions.

`condition` is a recursive discriminated union on `kind` — a rule's condition
is a tree of predicates (`ConditionLeaf`) combined with AND/OR
(`ConditionGroup`). A single predicate is a bare leaf, not a group-of-one.
Hysteresis lives on each leaf (a magnitude-based re-arm only makes sense
against one scalar comparison); `for_duration`/`cooldown` stay rule-level,
gating the tree's combined result — see rules/evaluators.py.
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


class ConditionLeaf(BaseModel):
    kind: Literal["leaf"] = "leaf"
    metric: str = Field(min_length=1, max_length=100)
    operator: str = Field(pattern=_OPERATOR_PATTERN)
    threshold: float
    hysteresis: float = Field(default=0.0, ge=0)


class ConditionGroup(BaseModel):
    kind: Literal["group"] = "group"
    op: Literal["AND", "OR"]
    # At least 2 — a group wrapping a single predicate is pointless; that case
    # is just a bare leaf.
    predicates: list["ConditionNode"] = Field(min_length=2)


ConditionNode = Annotated[ConditionLeaf | ConditionGroup, Field(discriminator="kind")]
ConditionGroup.model_rebuild()


class RuleCreateRequest(BaseModel):
    condition: ConditionNode
    for_duration: int = Field(default=0, ge=0)
    cooldown: int = Field(default=0, ge=0)
    action: ActionRequest
    enabled: bool = True


class RuleUpdateRequest(BaseModel):
    condition: ConditionNode | None = None
    for_duration: int | None = Field(default=None, ge=0)
    cooldown: int | None = Field(default=None, ge=0)
    action: ActionRequest | None = None
    enabled: bool | None = None


class RuleResponse(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    type: str
    condition: ConditionNode
    for_duration: int
    cooldown: int
    action: dict[str, object]
    enabled: bool
    created_at: datetime


class RuleWithDeviceResponse(RuleResponse):
    """The tenant-wide /rules list needs to say which device each rule
    belongs to — the per-device endpoints don't, since the device is already
    implied by the URL.
    """

    device_name: str
    device_slug: str
