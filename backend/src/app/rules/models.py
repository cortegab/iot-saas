"""SQLAlchemy models for rules and their device links.

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see
the migration) — small tables, never compressed, so no RLS/compression
conflict; they get the default treatment every other tenant-scoped table gets.

A rule is **independent of a single device** (the multi-device rule engine):

- `condition` is a tree of predicates. Each leaf carries its own `device_id`
  (leaf: device_id/metric/operator/threshold/hysteresis; group: op
  ["AND"|"OR"] + child predicates) — see rules/schemas.py's ConditionLeaf/
  ConditionGroup for the validated shape. Stored as opaque JSONB here; only
  the Pydantic layer validates it (no CHECK constraint can express a
  recursive shape). Evaluated by rules/evaluators.py.
- `actions` is a JSONB array — a rule can fire several actions, each possibly
  targeting a different device or an external system.
- `execution_policy` is JSONB: `{strategy, for_duration, cooldown,
  hysteresis, reset_condition}`. `strategy` is "edge" | "continuous" |
  "reset_condition" — how a fired rule re-arms.
- `trigger` is JSONB: `{type: "metric" | ...}` — metric-arrival only for now.

A rule has **no single device**. `rule_devices` records every (rule, device,
role) pair — `role` is "input" (a condition leaf reads it) or "target" (an
actuator action commands it). The hot-path cache does NOT read `rule_devices`
— the condition tree is self-describing — but CRUD keeps it in sync for
referential integrity, the "which rules touch device X" query, the response
`devices` list, and tenant-scoped validation.

`type` is the rule *kind* ('threshold' only for now; CLAUDE.md §5 also lists
'window'/'anomaly' as future values) — orthogonal to `condition`, which is
that kind's predicate tree.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RuleType(str, enum.Enum):
    THRESHOLD = "threshold"


class RuleOperator(str, enum.Enum):
    GT = ">"
    GTE = ">="
    LT = "<"
    LTE = "<="
    EQ = "=="
    NE = "!="


class RuleDeviceRole(str, enum.Enum):
    INPUT = "input"
    TARGET = "target"


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    description: Mapped[str | None] = mapped_column(nullable=True)
    type: Mapped[str] = mapped_column(nullable=False, default=RuleType.THRESHOLD.value)
    trigger: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    condition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    execution_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    # Node graph the visual builder round-trips — presentation only, the
    # engine never reads it.
    editor_graph: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    enabled: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RuleDevice(Base):
    __tablename__ = "rule_devices"
    __table_args__ = (
        UniqueConstraint("rule_id", "device_id", "role", name="uq_rule_devices_rule_device_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    rule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rules.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RuleExecution(Base):
    """One row per `Firing` (rules/evaluators.py) — written unconditionally by
    rules/service.py's _record_rule_execution, decoupling "the rule fired"
    from "a notification exists" (a Notification is also still written on
    every firing, unchanged; the two are parallel audit trails, not one
    replacing the other). `summary` snapshots the rendered condition text at
    fire time so the Activity tab still reads sensibly after the rule's
    condition later changes or the rule itself is deleted.
    """

    __tablename__ = "rule_executions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    # Nullable + SET NULL: execution history survives the rule being deleted,
    # same treatment commands.rule_id/notifications.rule_id already get.
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rules.id", ondelete="SET NULL"), nullable=True
    )
    # The triggering device — nullable + SET NULL for the same reason.
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    metric: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    summary: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ActionExecution(Base):
    """One row per action *attempt* within a RuleExecution — actuator_command/
    webhook/notification/unknown, each with a success|failed status and a
    loose JSONB `detail` bag (never re-parsed, purely for display — see
    RuleResponse.actions' own precedent for a loose dict alongside a sibling
    discriminator field). `action_index` reflects rule.actions' shape at
    dispatch time only — it is NOT a stable live reference; a later rule edit
    can reorder/change actions without touching old rows, so nothing should
    ever re-resolve it against the *current* rule (detail already carries
    everything needed to render a row standalone).
    """

    __tablename__ = "action_executions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    # CASCADE, unlike the SET NULL FKs above — action rows die with their
    # parent execution rather than surviving as orphans.
    rule_execution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rule_executions.id", ondelete="CASCADE"), nullable=False
    )
    action_type: Mapped[str] = mapped_column(String, nullable=False)
    action_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Only set for a successful actuator_command row — SET NULL rather than
    # CASCADE since a Command row outliving its action_execution (or vice
    # versa) is fine; they're independently useful audit records.
    command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("commands.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
