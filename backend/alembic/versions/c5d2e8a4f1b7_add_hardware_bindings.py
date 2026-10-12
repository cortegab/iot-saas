"""add hardware bindings to catalog entries and devices

Revision ID: c5d2e8a4f1b7
Revises: e8b1d4f7a2c6
Create Date: 2026-10-12T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c5d2e8a4f1b7"
down_revision: str | Sequence[str] | None = "e8b1d4f7a2c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    How a device is wired for the generic firmware (firmware/): a template's
    default on device_catalog_entries.hardware, and a device's own wiring on
    devices.hardware (null = the template's). Both nullable: entries and
    devices that predate the generic firmware have none, and keep using the
    generated sketch. Existing tables, so their RLS policies and iot_app
    grants already cover the new columns; no new table, no new policy.
    """
    op.add_column(
        "device_catalog_entries",
        sa.Column("hardware", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "devices",
        sa.Column("hardware", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("devices", "hardware")
    op.drop_column("device_catalog_entries", "hardware")
