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

from pydantic import BaseModel, Field, model_validator

_OPERATOR_PATTERN = r"^(>|>=|<|<=|==|!=|between|not_between|in|not_in|changed|increased|decreased)$"
_RANGE_OPERATORS = {"between", "not_between"}
_SET_OPERATORS = {"in", "not_in"}
_CHANGE_OPERATORS = {"changed", "increased", "decreased"}

RuleStrategy = Literal["edge", "continuous", "reset_condition"]


# ---- Actions -------------------------------------------------------------


class ActuatorCommandAction(BaseModel):
    type: Literal["actuator_command"] = "actuator_command"
    # None = the rule's primary device (the device-scoped wrapper / a
    # single-device rule); set = command a different device.
    device_id: uuid.UUID | None = None
    actuator: str = Field(min_length=1, max_length=100)
    value: bool | float | str


NotificationChannel = Literal["platform", "email"]


def _default_channels() -> list[NotificationChannel]:
    return ["platform"]


class NotificationAction(BaseModel):
    type: Literal["notification"] = "notification"
    message: str = Field(min_length=1, max_length=1000)
    # "platform" = the in-app activity feed row (always written on a firing
    # regardless). "email" = also send to the tenant's notification_emails
    # (or, if unset, owner/admin members). Pre-Phase-4 rules have no
    # `channels` field — readers default to ["platform"].
    channels: list[NotificationChannel] = Field(default_factory=_default_channels, min_length=1)


class RetryConfig(BaseModel):
    max_attempts: int = Field(default=4, ge=2, le=6)
    timeout_s: float = Field(default=5.0, ge=1, le=30)


class WebhookAction(BaseModel):
    type: Literal["webhook"] = "webhook"
    url: str = Field(min_length=1, max_length=2000)
    body: dict[str, object] = Field(default_factory=dict)
    # Optional per-action override of the default retry policy (4 attempts,
    # exponential backoff, 5s per-attempt timeout).
    retry: RetryConfig | None = None
    timeout_s: float | None = Field(default=None, ge=1, le=30)


ActionRequest = Annotated[
    ActuatorCommandAction | NotificationAction | WebhookAction, Field(discriminator="type")
]


# ---- Triggers -----------------------------------------------------------


class MetricTrigger(BaseModel):
    type: Literal["metric"] = "metric"


class ScheduleTrigger(BaseModel):
    type: Literal["schedule"] = "schedule"
    # A standard 5-field cron expression. Validated in rules/service.py
    # (croniter.is_valid) — there's no field_validator precedent in this file.
    cron: str = Field(min_length=1, max_length=120)
    timezone: str = "UTC"


class ManualTrigger(BaseModel):
    type: Literal["manual"] = "manual"


class DeviceStatusTrigger(BaseModel):
    type: Literal["device_status"] = "device_status"
    device_id: uuid.UUID
    transition: Literal["connected", "disconnected"]


TriggerRequest = Annotated[
    MetricTrigger | ScheduleTrigger | ManualTrigger | DeviceStatusTrigger,
    Field(discriminator="type"),
]


# ---- Condition tree ---------------------------------------------------------


class StaticRhs(BaseModel):
    """A fixed number to compare against — the pre-Phase-6 `threshold` shape."""

    source: Literal["static"] = "static"
    value: float


class RangeRhs(BaseModel):
    """`between`/`not_between`'s two-sided bound."""

    source: Literal["range"] = "range"
    low: float
    high: float


class SetRhs(BaseModel):
    """`in`/`not_in`'s membership list."""

    source: Literal["set"] = "set"
    values: list[float] = Field(min_length=1)


class MetricRhs(BaseModel):
    """Compare against another signal's live value instead of a static number."""

    source: Literal["metric"] = "metric"
    device_id: uuid.UUID
    metric: str = Field(min_length=1, max_length=100)


RhsSpec = Annotated[StaticRhs | RangeRhs | SetRhs | MetricRhs, Field(discriminator="source")]


class ConditionLeaf(BaseModel):
    kind: Literal["leaf"] = "leaf"
    # None only while a device-scoped body is being normalised — the service
    # stamps the path device before anything is stored or evaluated.
    device_id: uuid.UUID | None = None
    metric: str = Field(min_length=1, max_length=100)
    operator: str = Field(pattern=_OPERATOR_PATTERN)
    # None only for changed/increased/decreased, which compare this signal's
    # latest reading against its own previous one — there's nothing to supply.
    rhs: RhsSpec | None = None
    hysteresis: float = Field(default=0.0, ge=0)

    @model_validator(mode="after")
    def _check_rhs_matches_operator(self) -> "ConditionLeaf":
        if self.operator in _CHANGE_OPERATORS:
            if self.rhs is not None:
                raise ValueError(f"operator {self.operator!r} takes no rhs value")
        elif self.operator in _RANGE_OPERATORS:
            if not isinstance(self.rhs, RangeRhs):
                raise ValueError(f"operator {self.operator!r} requires a range rhs")
        elif self.operator in _SET_OPERATORS:
            if not isinstance(self.rhs, SetRhs):
                raise ValueError(f"operator {self.operator!r} requires a set rhs")
        elif not isinstance(self.rhs, StaticRhs | MetricRhs):
            raise ValueError(f"operator {self.operator!r} requires a static or metric rhs")
        return self


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
    # None only when trigger.type == "device_status" — a pure "notify me when
    # device X disconnects" rule has no natural leaf to express "always true".
    condition: ConditionNode | None = None
    execution_policy: ExecutionPolicy = Field(default_factory=ExecutionPolicy)
    actions: list[ActionRequest] = Field(min_length=1)
    editor_graph: dict[str, Any] | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def _condition_required_unless_device_status(self) -> "RuleCreateRequest":
        if self.condition is None and self.trigger.type != "device_status":
            raise ValueError('condition is required unless trigger.type == "device_status"')
        return self


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


class RuleSignalHealth(BaseModel):
    """The freshness of one `(device, metric)` a rule reads — computed from
    device_metric_health + the catalog publish profile (Phase 5)."""

    device_id: uuid.UUID
    device_name: str | None
    metric: str
    # "missing" covers no health row yet, the device removed from the tenant,
    # or the device no longer active.
    state: Literal["fresh", "stale", "missing"]
    last_value: float | None
    last_seen_at: datetime | None
    max_age_seconds: int


class RuleHealth(BaseModel):
    # True iff every referenced signal is "fresh" — i.e. the rule can actually
    # evaluate its condition right now rather than silently failing leaves closed.
    evaluatable: bool
    signals: list[RuleSignalHealth]


class RuleResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    type: str
    trigger: dict[str, Any]
    condition: ConditionNode | None
    execution_policy: ExecutionPolicy
    actions: list[dict[str, object]]
    # Every device the rule reads (`input`) or commands (`target`) — the only
    # device relationship a rule has.
    devices: list[RuleDeviceRef]
    enabled: bool
    created_at: datetime
    # Computed per request: can this rule currently evaluate (all inputs fresh)?
    health: RuleHealth
    # Back-compat: the first action / the policy's timing, so existing
    # single-action clients keep reading the fields they always have.
    action: dict[str, object]
    for_duration: int
    cooldown: int


# ---- Execution history -----------------------------------------------------


class ActionExecutionResponse(BaseModel):
    id: uuid.UUID
    action_type: str
    # Position in the rule's actions list at dispatch time — NOT a stable
    # live reference (a later rule edit can reorder/change actions without
    # touching old rows). `detail` below already carries everything needed
    # to render a row standalone.
    action_index: int | None
    status: Literal["success", "failed"]
    # Loose by design, not a discriminated union — mirrors RuleResponse
    # .actions' own precedent (a display/config bag the frontend switches on
    # via the sibling `action_type` field, never re-parsed or re-executed).
    detail: dict[str, object] | None
    command_id: uuid.UUID | None
    created_at: datetime


class RuleExecutionResponse(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID | None
    device_id: uuid.UUID | None
    device_name: str | None
    # Null for schedule/manual fires — there's no triggering signal.
    metric: str | None
    value: float | None
    trigger_source: str  # "metric" | "schedule" | "manual"
    fired_at: datetime
    # Snapshotted condition summary at fire time — still reads sensibly after
    # the rule's condition later changes or the rule itself is deleted.
    summary: str
    created_at: datetime
    actions: list[ActionExecutionResponse]


class FailedActionResponse(BaseModel):
    """One failed delivery attempt across the whole tenant — the
    /rules/failed-actions operational feed."""

    id: uuid.UUID
    rule_id: uuid.UUID | None
    rule_name: str | None
    action_type: str
    action_index: int | None
    detail: dict[str, object] | None
    summary: str
    fired_at: datetime
    created_at: datetime


# ---- Simulate / dry-run --------------------------------------------------


class SignalOverride(BaseModel):
    device_id: uuid.UUID
    metric: str
    value: float


class SimulateReplayWindow(BaseModel):
    from_: datetime = Field(alias="from")
    to: datetime


class SimulateRequest(BaseModel):
    # Substitute specific signal values before evaluating ("what if temperature
    # were 45?"). An override is always treated as fresh.
    overrides: list[SignalOverride] = Field(default_factory=list)
    # When set, ignore live values and replay the rule over stored telemetry
    # for this window instead.
    replay: SimulateReplayWindow | None = None


class SimulateActionPreview(BaseModel):
    index: int
    type: str
    summary: str


class SimulateReplayResult(BaseModel):
    resolution: Literal["raw", "1m"]
    samples: int
    would_have_fired_at: list[datetime]
    # True when the window hit simulate_replay_max_samples and the walk stopped early.
    truncated: bool


class SimulateResponse(BaseModel):
    mode: Literal["live", "replay"]
    evaluated_at: datetime
    would_fire: bool
    # The annotated condition tree (leaf/group dicts from evaluators
    # .explain_condition). None in replay mode.
    condition: dict[str, Any] | None
    # Referenced signals that were stale/missing (and not overridden) at
    # evaluation time — why `would_fire` may be False.
    unavailable_signals: list[RuleSignalHealth]
    actions: list[SimulateActionPreview]
    replay: SimulateReplayResult | None
