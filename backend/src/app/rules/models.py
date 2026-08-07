"""SQLAlchemy model for rules.

Tenant-scoped: RLS-protected with the standard single-tenant predicate (see
the migration) — unlike `telemetry`, this table is small and never
compressed, so there's no RLS/compression conflict here; it gets the default
treatment every other tenant-scoped table gets.

`type` only allows 'threshold' for now (CLAUDE.md §5's schema also lists
'window' and 'anomaly' as future values) — the check constraint and the
`RuleType` enum are both written to make adding one later a one-line change,
not a redesign. This is orthogonal to `condition` below: `type` is the rule
*kind*, `condition` is that kind's actual predicate tree.

`condition` is a tree of predicates (leaf: metric/operator/threshold/
hysteresis; group: op ["AND"|"OR"] + child predicates) — see
rules/schemas.py's ConditionLeaf/ConditionGroup for the validated shape.
Stored as opaque JSONB here; only the Pydantic layer validates it, the same
treatment `action` already gets (no CHECK constraint can express a recursive
shape). Evaluated by rules/evaluators.py.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
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


class Rule(Base):
    __tablename__ = "rules"
    __table_args__ = (CheckConstraint("type IN ('threshold')", name="ck_rules_type"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(nullable=False, default=RuleType.THRESHOLD.value)
    condition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Seconds the combined condition must hold before firing / minimum time between firings.
    for_duration: Mapped[int] = mapped_column(nullable=False, default=0)
    # {"type": "actuator_command"|"notification"|"webhook", ...action-specific fields}
    action: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    cooldown: Mapped[int] = mapped_column(nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
