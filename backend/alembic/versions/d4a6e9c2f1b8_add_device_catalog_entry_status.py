"""add status column to device catalog entries

Revision ID: d4a6e9c2f1b8
Revises: c3f8b1e6a4d7
Create Date: 2026-08-10T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4a6e9c2f1b8"
down_revision: str | Sequence[str] | None = "c3f8b1e6a4d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Lets the Device Types catalog expose a real Active/Disabled status (spec's
    context-menu "Disable" action) instead of only distinguishing the
    migration-seeded "Legacy" entry. No RLS change needed — the table is
    already RLS-protected (b7d3f8a2c1e9), this only adds a column to it.
    """
    op.add_column(
        "device_catalog_entries",
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
    )
    op.create_check_constraint(
        "ck_device_catalog_entries_status",
        "device_catalog_entries",
        "status IN ('active', 'disabled')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_device_catalog_entries_status", "device_catalog_entries", type_="check"
    )
    op.drop_column("device_catalog_entries", "status")
