"""Pydantic request/response models for the rules routes.

A rule is a *canonical definition* the engine executes directly:

- `trigger` — a discriminated union on `type` (metric-arrival only for now).
- `condition` — a recursive discriminated union on `kind`: a tree of
  predicates (`ConditionLeaf`, each carrying its own `device_id`) combined
  with AND/OR (`ConditionGroup`). A single predicate is a bare leaf, not a
  group-of-one. Per-leaf hysteresis stabilises that leaf's boolean; the
  combined tree result is gated by `execution_policy`.
- `execution_policy` — `strategy` ("edge" | "continuous" | "reset_condition")
  plus `for_duration` / `cooldown`, and an optional `reset_condition` tree.
- `actions` — a list; each action may target a different device or an
  external system.

`POST /devices/{device_id}/rules` is a backward-compatible wrapper: its body
omits per-leaf/per-action `device_id` (the path device is implied) and still
accepts the pre-multi-device `action` / `for_duration` / `cooldown` fields.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

_OPERATOR_PATTERN = r"^(>|>=|<|<=|==|!=)$"

RuleStrategy = Literal["edge", "continuous", "reset_condition"]


# ---- Actions -------------------------------------------------------------


class ActuatorCommandAction(BaseModel):
    type: Literal["actuator_command"] = "actuator_command"
    # None = the rule's primary device (the device-scoped wrapper / a
    # single-device rule); set = command a different device.
    device_id: uuid.UUID | None = None
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


# ---- Triggers -----------------------------------------------------------


class MetricTrigger(BaseModel):
    type: Literal["metric"] = "metric"


TriggerRequest = Annotated[MetricTrigger, Field(discriminator="type")]


# ---- Condition tree ---------------------------------------------------------


class ConditionLeaf(BaseModel):
    kind: Literal["leaf"] = "leaf"
    # None only while a device-scoped body is being normalised — the service
    # stamps the path device before anything is stored or evaluated.
    device_id: uuid.UUID | None = None
    metric: str = Field(min_length=1, max_length=100)
    operator: str = Field(pattern=_OPERATOR_PATTERN)
    threshold: float
    hysteresis: float = Field(default=0.0, ge=0)


class ConditionGroup(BaseModel):
    kind: Literal["group"] = "group"
    op: Literal["AND", "OR"]
    # At least 2 — a group wrapping a single predicate is pointless; that
    # case is just a bare leaf.
    predicates: list["ConditionNode"] = Field(min_length=2)


ConditionNode = Annotated[ConditionLeaf | ConditionGroup, Field(discriminator="kind")]
ConditionGroup.model_rebuild()


class ExecutionPolicy(BaseModel):
    strategy: RuleStrategy = "edge"
    for_duration: int = Field(default=0, ge=0)
    cooldown: int = Field(default=0, ge=0)
    # Only meaningful when strategy == "reset_condition": the rule cannot
    # fire again until this tree evaluates true.
    reset_condition: ConditionNode | None = None


# ---- Requests -------------------------------------------------------------


class RuleCreateRequest(BaseModel):
    """Canonical multi-device create — POST /rules."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    trigger: TriggerRequest = Field(default_factory=MetricTrigger)
    condition: ConditionNode
    execution_policy: ExecutionPolicy = Field(default_factory=ExecutionPolicy)
    actions: list[ActionRequest] = Field(min_length=1)
    editor_graph: dict[str, Any] | None = None
    enabled: bool = True


class DeviceRuleCreateRequest(BaseModel):
    """Backward-compatible single-device create — POST /devices/{id}/rules.

    Leaves and actuator actions inherit the path device; the pre-multi-device
    `action` / `for_duration` / `cooldown` fields are still accepted.
    """

    name: str | None = Field(default=None, max_length=200)
    condition: ConditionNode
    for_duration: int = Field(default=0, ge=0)
    cooldown: int = Field(default=0, ge=0)
    action: ActionRequest | None = None
    actions: list[ActionRequest] | None = Field(default=None, min_length=1)
    enabled: bool = True


class RuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    trigger: TriggerRequest | None = None
    condition: ConditionNode | None = None
    execution_policy: ExecutionPolicy | None = None
    actions: list[ActionRequest] | None = Field(default=None, min_length=1)
    editor_graph: dict[str, Any] | None = None
    enabled: bool | None = None
    # Legacy single-device fields (still honoured for existing clients).
    for_duration: int | None = Field(default=None, ge=0)
    cooldown: int | None = Field(default=None, ge=0)
    action: ActionRequest | None = None


# ---- Responses -----------------------------------------------------------


class RuleDeviceRef(BaseModel):
    device_id: uuid.UUID
    role: Literal["input", "target"]
    device_name: str | None = None


class RuleResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    type: str
    trigger: dict[str, Any]
    condition: ConditionNode
    execution_policy: ExecutionPolicy
    actions: list[dict[str, object]]
    # Every device the rule reads (`input`) or commands (`target`) — the only
    # device relationship a rule has.
    devices: list[RuleDeviceRef]
    enabled: bool
    created_at: datetime
    # Back-compat: the first action / the policy's timing, so existing
    # single-action clients keep reading the fields they always have.
    action: dict[str, object]
    for_duration: int
    cooldown: int
