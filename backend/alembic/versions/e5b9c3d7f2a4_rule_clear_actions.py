"""rule on-clear actions

Revision ID: e5b9c3d7f2a4
Revises: d4a8f2c6e1b9
Create Date: 2026-09-25T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "e5b9c3d7f2a4"
down_revision: str | Sequence[str] | None = "d4a8f2c6e1b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """- `rules.clear_actions`: actions fired once when a fired rule's
      condition is known-false again (e.g. switch released -> LED off).
    - `rule_executions.edge`: whether a history row is a firing or a clear.

    `execution_policy.clear_for_duration` is JSONB-only, no DDL. No new table,
    so no RLS work; `list_enabled_rules()` is `RETURNS SETOF rules` /
    `SELECT *` and picks the new column up without being recreated.
    """
    op.add_column(
        "rules",
        sa.Column("clear_actions", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "rule_executions",
        sa.Column("edge", sa.String(), nullable=False, server_default="fire"),
    )
    op.create_check_constraint(
        "ck_rule_executions_edge", "rule_executions", "edge IN ('fire', 'clear')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_rule_executions_edge", "rule_executions", type_="check")
    op.drop_column("rule_executions", "edge")
    op.drop_column("rules", "clear_actions")
