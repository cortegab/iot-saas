"""alarm lifecycle

Revision ID: b2c8e4f6a1d3
Revises: a9d4e2c6f8b1
Create Date: 2026-11-19T23:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c8e4f6a1d3"
down_revision: str | Sequence[str] | None = "a9d4e2c6f8b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    The alarm lifecycle (DESIGN.md §13) on `notifications` (tenant_id and RLS
    already in place): Active -> Acknowledged (who, when, an optional note;
    owners and admins) -> Cleared (the condition went away: the device came
    back online, the rule cleared). Read and dismissed stay as they were; what
    "needs attention" counts is now an active (unacknowledged, uncleared)
    critical alarm, so opening an alert no longer silences it for everyone.
    """
    op.add_column(
        "notifications", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column(
            "acknowledged_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("notifications", sa.Column("acknowledged_note", sa.String(), nullable=True))
    op.add_column(
        "notifications", sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_notifications_active",
        "notifications",
        ["tenant_id", "severity"],
        postgresql_where=sa.text(
            "acknowledged_at IS NULL AND cleared_at IS NULL AND dismissed_at IS NULL"
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_notifications_active", table_name="notifications")
    op.drop_column("notifications", "cleared_at")
    op.drop_column("notifications", "acknowledged_note")
    op.drop_column("notifications", "acknowledged_by")
    op.drop_column("notifications", "acknowledged_at")
