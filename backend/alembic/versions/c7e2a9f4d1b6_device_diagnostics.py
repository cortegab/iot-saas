"""device diagnostics

Revision ID: c7e2a9f4d1b6
Revises: b3e8f1a5c7d2
Create Date: 2026-11-08T19:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c7e2a9f4d1b6"
down_revision: str | Sequence[str] | None = "b3e8f1a5c7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    The status message's diagnostics (generic firmware 0.14.0+): why the board
    last restarted, boots since install, heap, Wi-Fi rejoins and the sensors
    not answering. Columns on `devices`, which already has tenant_id and its
    RLS policy, so nothing new to secure.
    """
    op.add_column("devices", sa.Column("reset_reason", sa.String(), nullable=True))
    op.add_column("devices", sa.Column("boot_count", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("heap_free", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("heap_min", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("wifi_reconnects", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("faults", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for column in (
        "faults",
        "wifi_reconnects",
        "heap_min",
        "heap_free",
        "boot_count",
        "reset_reason",
    ):
        op.drop_column("devices", column)
