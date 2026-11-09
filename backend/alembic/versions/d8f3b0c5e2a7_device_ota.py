"""device ota

Revision ID: d8f3b0c5e2a7
Revises: c7e2a9f4d1b6
Create Date: 2026-11-08T20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d8f3b0c5e2a7"
down_revision: str | Sequence[str] | None = "c7e2a9f4d1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Over-the-air updates (app.firmware, generic firmware 1.0.0+): the version
    last requested for a device and when, and its progress as the device
    reports it. Columns on `devices` (tenant_id and RLS already in place).
    """
    op.add_column("devices", sa.Column("ota_target", sa.String(), nullable=True))
    op.add_column(
        "devices", sa.Column("ota_requested_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("devices", sa.Column("ota_state", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for column in ("ota_state", "ota_requested_at", "ota_target"):
        op.drop_column("devices", column)
