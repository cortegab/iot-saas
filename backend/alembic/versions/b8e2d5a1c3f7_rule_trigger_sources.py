"""rule trigger sources: nullable metric/value + trigger_source on rule_executions

Revision ID: b8e2d5a1c3f7
Revises: a3c9e1f4b8d2
Create Date: 2026-09-10T00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e2d5a1c3f7"
down_revision: str | Sequence[str] | None = "a3c9e1f4b8d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema (Phase 4 triggers half).

    A schedule- or manual-triggered firing has no triggering signal, so
    `rule_executions.metric` / `.value` become nullable, and a
    `trigger_source` column records which path fired the rule (the Activity
    tab shows a badge for anything other than `metric`).

    No `rules`-table change: `Rule.trigger` is already `JSONB NOT NULL`,
    `list_enabled_rules()` is `SELECT *`, and `load_rule_cache` reads
    `row["trigger"]`, so the new `schedule` / `manual` trigger shapes flow
    through with no schema work.
    """
    op.alter_column("rule_executions", "metric", nullable=True)
    op.alter_column("rule_executions", "value", nullable=True)
    op.add_column(
        "rule_executions",
        sa.Column(
            "trigger_source",
            sa.String(),
            nullable=False,
            server_default="metric",
        ),
    )
    op.create_check_constraint(
        "ck_rule_executions_trigger_source",
        "rule_executions",
        "trigger_source IN ('metric', 'schedule', 'manual')",
    )


def downgrade() -> None:
    """Downgrade schema. Defensive backfill for the re-added NOT NULLs
    (repo convention — see e7b1c4a92f30)."""
    op.drop_constraint("ck_rule_executions_trigger_source", "rule_executions", type_="check")
    op.drop_column("rule_executions", "trigger_source")
    op.execute("UPDATE rule_executions SET metric = '' WHERE metric IS NULL")
    op.execute("UPDATE rule_executions SET value = 0 WHERE value IS NULL")
    op.alter_column("rule_executions", "metric", nullable=False)
    op.alter_column("rule_executions", "value", nullable=False)
