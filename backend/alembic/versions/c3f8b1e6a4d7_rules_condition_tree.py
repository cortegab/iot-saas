"""rules condition tree

Revision ID: c3f8b1e6a4d7
Revises: b7d3f8a2c1e9
Create Date: 2026-08-07T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "c3f8b1e6a4d7"
down_revision: str | Sequence[str] | None = "b7d3f8a2c1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Replaces the flat metric/operator/threshold/hysteresis columns with a
    recursive `condition` JSONB tree (rules/schemas.py's ConditionLeaf/
    ConditionGroup) — supports multi-metric AND/OR rules, not just a single
    comparison. Every existing row backfills into a single-leaf tree, so no
    rule's behavior changes.

    `ck_rules_operator` is dropped since `operator` no longer exists as a
    top-level column — validated at the Pydantic layer only now, same
    treatment `action` already gets (no CHECK constraint can express a
    recursive shape).
    """
    op.add_column("rules", sa.Column("condition", JSONB(), nullable=True))
    op.execute(
        """
        UPDATE rules SET condition = jsonb_build_object(
            'kind', 'leaf',
            'metric', metric,
            'operator', operator,
            'threshold', threshold,
            'hysteresis', hysteresis
        )
        """
    )
    op.alter_column("rules", "condition", nullable=False)

    op.drop_index("ix_rules_device_metric", table_name="rules")
    op.execute("ALTER TABLE rules DROP CONSTRAINT IF EXISTS ck_rules_operator")
    op.drop_column("rules", "metric")
    op.drop_column("rules", "operator")
    op.drop_column("rules", "threshold")
    op.drop_column("rules", "hysteresis")

    # Metric-based lookup now happens in-process via the worker's rule cache
    # (rules/service.py), not SQL — an index on device_id alone still helps
    # the CRUD API's per-device list/RLS-scoped queries.
    op.execute("CREATE INDEX ix_rules_device ON rules (device_id)")


def downgrade() -> None:
    """Downgrade schema.

    Best-effort: only faithful for rows whose condition is a single leaf
    (the common case, and the only shape that existed before this migration
    ever ran). A row with a real multi-predicate tree has no flat
    equivalent — it backfills to NULL/zero flat columns rather than failing
    the whole downgrade, since downgrade here is a safety-net escape hatch,
    not a guaranteed round-trip (matching this repo's other migrations).
    """
    op.add_column("rules", sa.Column("metric", sa.String(), nullable=True))
    op.add_column("rules", sa.Column("operator", sa.String(), nullable=True))
    op.add_column("rules", sa.Column("threshold", sa.Float(), nullable=True))
    op.add_column(
        "rules", sa.Column("hysteresis", sa.Float(), nullable=False, server_default="0")
    )
    op.execute(
        """
        UPDATE rules SET
            metric = condition->>'metric',
            operator = condition->>'operator',
            threshold = (condition->>'threshold')::float,
            hysteresis = COALESCE((condition->>'hysteresis')::float, 0)
        WHERE condition->>'kind' = 'leaf'
        """
    )
    op.drop_index("ix_rules_device", table_name="rules")
    op.drop_column("rules", "condition")
    op.execute("CREATE INDEX ix_rules_device_metric ON rules (device_id, metric)")
