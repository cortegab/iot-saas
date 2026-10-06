"""zero hysteresis on leaves whose operator ignores it

Revision ID: d4a8f2c6e1b9
Revises: c7e4a9f1d3b6
Create Date: 2026-09-25T00:00:00.000000

"""

import json
from collections.abc import Sequence
from typing import Any

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "d4a8f2c6e1b9"
down_revision: str | Sequence[str] | None = "c7e4a9f1d3b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HYSTERESIS_OPERATORS = {">", ">=", "<", "<="}


def _zero_ignored(node: dict[str, Any]) -> dict[str, Any]:
    if node.get("kind") == "leaf":
        if node.get("operator") not in _HYSTERESIS_OPERATORS and node.get("hysteresis"):
            return {**node, "hysteresis": 0.0}
        return node
    return {**node, "predicates": [_zero_ignored(child) for child in node["predicates"]]}


def upgrade() -> None:
    """Only >, >=, <, <= latch with hysteresis (evaluators._evaluate_leaf);
    every other operator silently ignored a stored non-zero value. The API now
    rejects that combination, so zero existing ones — no behaviour change, the
    evaluator never read them — so they don't fail validation on next edit.
    """
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, condition, execution_policy FROM rules")).fetchall()
    for row in rows:
        condition = _zero_ignored(row.condition) if row.condition is not None else None
        policy = dict(row.execution_policy or {})
        reset = policy.get("reset_condition")
        if reset is not None:
            policy["reset_condition"] = _zero_ignored(reset)
        if condition == row.condition and policy == (row.execution_policy or {}):
            continue
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


def downgrade() -> None:
    """No-op: the zeroed values were never read by the evaluator."""
