"""notification severity/kind/detail/dismissal and action retry marker

Revision ID: f1b7d3a9c5e2
Revises: d2a6f8b3c7e4
Create Date: 2026-10-01T11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1b7d3a9c5e2"
down_revision: str | Sequence[str] | None = "d2a6f8b3c7e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Notifications (DESIGN.md §8):
    - `severity` (info | warning | critical) and `kind` — what produced it:
      rule_fired, rule_cleared, rule_health, device_offline, delivery_failed,
      template_changed. Existing rows are rule firings → warning / rule_fired.
    - `detail`: an optional second line under the message.
    - `catalog_entry_id`: links a template_changed row to its template.
    - `dismissed_at`: dismissed rows leave the feed; Undo clears it.

    action_executions.retried_at: set on a failed delivery once someone retries
    it, so the failed-deliveries feed shows only the latest attempt.

    Columns on existing tables only — their RLS policies already cover them.
    action_executions stays append-only for the app role except for this one
    marker: a column-level UPDATE grant on `retried_at`, nothing else.
    """
    op.add_column(
        "notifications",
        sa.Column("severity", sa.String(), nullable=False, server_default="warning"),
    )
    op.add_column(
        "notifications",
        sa.Column("kind", sa.String(), nullable=False, server_default="rule_fired"),
    )
    op.add_column("notifications", sa.Column("detail", sa.String(), nullable=True))
    op.add_column(
        "notifications",
        sa.Column(
            "catalog_entry_id",
            sa.Uuid(),
            sa.ForeignKey("device_catalog_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "notifications", sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "ck_notifications_severity", "notifications", "severity IN ('info', 'warning', 'critical')"
    )
    op.add_column(
        "action_executions",
        sa.Column("retried_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("GRANT UPDATE (retried_at) ON action_executions TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("REVOKE UPDATE (retried_at) ON action_executions FROM iot_app")
    op.drop_column("action_executions", "retried_at")
    op.drop_constraint("ck_notifications_severity", "notifications", type_="check")
    op.drop_column("notifications", "dismissed_at")
    op.drop_column("notifications", "catalog_entry_id")
    op.drop_column("notifications", "detail")
    op.drop_column("notifications", "kind")
    op.drop_column("notifications", "severity")
