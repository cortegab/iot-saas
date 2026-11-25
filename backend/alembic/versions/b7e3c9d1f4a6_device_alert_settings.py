"""device alert settings: mute, and a back-online notice

Revision ID: b7e3c9d1f4a6
Revises: a2d6f8b4c1e9
Create Date: 2026-11-25T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e3c9d1f4a6"
down_revision: str | Sequence[str] | None = "a2d6f8b4c1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Alert settings per device (ease-of-use plan C6): alerts_muted_until stops
    its offline and device-health alerts until then (far future = until
    turned back on); notify_back_online adds a "back online" notice. `devices`
    already has tenant_id and its RLS policy. Read by the worker's status
    path, not the readings -> rules hot path (CLAUDE.md §9.1).
    """
    op.add_column(
        "devices", sa.Column("alerts_muted_until", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "devices",
        sa.Column("notify_back_online", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("devices", "notify_back_online")
    op.drop_column("devices", "alerts_muted_until")
