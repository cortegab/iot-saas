"""rule operators rhs + device_status trigger

Revision ID: c7e4a9f1d3b6
Revises: b8e2d5a1c3f7
Create Date: 2026-09-24T00:00:00.000000

"""

import json
from collections.abc import Sequence
from typing import Any

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "c7e4a9f1d3b6"
down_revision: str | Sequence[str] | None = "b8e2d5a1c3f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _threshold_to_rhs(node: dict[str, Any]) -> dict[str, Any]:
    """Every leaf's bare `threshold: X` -> `rhs: {"source": "static", "value": X}`
    — the pre-Phase-6 shape becomes the trivial case of the new rhs union.
    Recurses through groups; also used for execution_policy.reset_condition,
    which reuses the same condition-tree shape.
    """
    if node.get("kind") == "leaf":
        new_node = {k: v for k, v in node.items() if k != "threshold"}
        new_node["rhs"] = {"source": "static", "value": node["threshold"]}
        return new_node
    return {**node, "predicates": [_threshold_to_rhs(child) for child in node["predicates"]]}


def _rhs_to_threshold(node: dict[str, Any]) -> dict[str, Any]:
    """Inverse, for downgrade. Lossy for any leaf whose rhs isn't `static`
    (range/set/metric) or that has none (changed/increased/decreased) —
    those become `threshold: 0`, since a flat threshold has no equivalent
    for those operators/shapes. Accepted limitation, same tolerance this
    repo's other JSONB-evolution downgrades already extend (e.g.
    e7b1c4a92f30's downgrade dropping extra input devices/actions).
    """
    if node.get("kind") == "leaf":
        new_node = {k: v for k, v in node.items() if k != "rhs"}
        rhs = node.get("rhs") or {}
        new_node["threshold"] = rhs.get("value", 0) if rhs.get("source") == "static" else 0
        return new_node
    return {**node, "predicates": [_rhs_to_threshold(child) for child in node["predicates"]]}


def upgrade() -> None:
    """Upgrade schema (rule-engine Phase 6).

    - `rules.condition` becomes nullable — a `device_status` trigger rule may
      have no condition tree at all (the trigger event itself is the
      condition; `evaluators.py`'s None handling treats it as always-true).
    - Every existing leaf's `threshold: X` becomes `rhs: {"source": "static",
      "value": X}` (both in `condition` and, if present,
      `execution_policy.reset_condition` — same recursive tree shape). No
      rule's behaviour changes: `StaticRhs` with `==`/`>`/etc. compares
      identically to the old bare `threshold`.
    - `rule_executions.trigger_source` CHECK widens to allow `'device_status'`
      alongside the existing `metric`/`schedule`/`manual`.

    Operators (`_OPERATOR_PATTERN`), the new trigger variant, and the
    evaluator's operator families are Pydantic/application-layer only — no
    CHECK constraint expresses a recursive JSONB shape (same as every other
    condition-tree migration in this repo).
    """
    op.execute("ALTER TABLE rules ALTER COLUMN condition DROP NOT NULL")

    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, condition, execution_policy FROM rules")).fetchall()
    for row in rows:
        condition = _threshold_to_rhs(row.condition) if row.condition is not None else None
        policy = dict(row.execution_policy or {})
        reset = policy.get("reset_condition")
        if reset is not None:
            policy["reset_condition"] = _threshold_to_rhs(reset)
        conn.execute(
            text(
                "UPDATE rules SET "
                "condition = CAST(:condition AS jsonb), "
                "execution_policy = CAST(:policy AS jsonb) "
                "WHERE id = :id"
            ),
            {
                "condition": json.dumps(condition) if condition is not None else None,
                "policy": json.dumps(policy),
                "id": row.id,
            },
        )

    op.drop_constraint("ck_rule_executions_trigger_source", "rule_executions", type_="check")
    op.create_check_constraint(
        "ck_rule_executions_trigger_source",
        "rule_executions",
        "trigger_source IN ('metric', 'schedule', 'manual', 'device_status')",
    )


def downgrade() -> None:
    """Downgrade schema. Best-effort, matching this repo's other JSONB
    migrations: a `device_status` rule (condition IS NULL) has no pre-Phase-6
    equivalent and is dropped outright; every other rule's rhs collapses back
    to a bare threshold (lossy for range/set/metric/none-rhs leaves — see
    _rhs_to_threshold).
    """
    conn = op.get_bind()

    conn.execute(text("DELETE FROM rules WHERE condition IS NULL"))

    conn.execute(
        text(
            "UPDATE rule_executions SET trigger_source = 'manual' "
            "WHERE trigger_source = 'device_status'"
        )
    )
    op.drop_constraint("ck_rule_executions_trigger_source", "rule_executions", type_="check")
    op.create_check_constraint(
        "ck_rule_executions_trigger_source",
        "rule_executions",
        "trigger_source IN ('metric', 'schedule', 'manual')",
    )

    rows = conn.execute(text("SELECT id, condition, execution_policy FROM rules")).fetchall()
    for row in rows:
        condition = _rhs_to_threshold(row.condition)
        policy = dict(row.execution_policy or {})
        reset = policy.get("reset_condition")
        if reset is not None:
            policy["reset_condition"] = _rhs_to_threshold(reset)
        conn.execute(
            text(
                "UPDATE rules SET "
                "condition = CAST(:condition AS jsonb), "
                "execution_policy = CAST(:policy AS jsonb) "
                "WHERE id = :id"
            ),
            {"condition": json.dumps(condition), "policy": json.dumps(policy), "id": row.id},
        )

    op.execute("ALTER TABLE rules ALTER COLUMN condition SET NOT NULL")
