"""device templates say how their devices run: our firmware or own code

Revision ID: a9d4e7c2b8f1
Revises: e4a8c2f6b9d3
Create Date: 2026-10-17T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9d4e7c2b8f1"
down_revision: str | Sequence[str] | None = "e4a8c2f6b9d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    A new column on an existing table: its RLS policy and iot_app's grants
    already cover it. Templates with wiring run the generic firmware; the rest
    (no wiring) run code of their own, as their devices get the sketch.
    Runs as the migration role, so RLS hides no tenant's rows.
    """
    op.add_column(
        "device_catalog_entries",
        sa.Column("runs_on", sa.Text(), nullable=False, server_default="own_code"),
    )
    op.create_check_constraint(
        "ck_device_catalog_entries_runs_on",
        "device_catalog_entries",
        "runs_on IN ('generic_firmware', 'own_code')",
    )
    op.execute(
        "UPDATE device_catalog_entries SET runs_on = 'generic_firmware' WHERE hardware IS NOT NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_device_catalog_entries_runs_on", "device_catalog_entries", type_="check")
    op.drop_column("device_catalog_entries", "runs_on")
