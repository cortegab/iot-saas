"""devices record when their credential was last made

Revision ID: c3e8a1f5d2b9
Revises: a9d4e7c2b8f1
Create Date: 2026-10-20T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e8a1f5d2b9"
down_revision: str | Sequence[str] | None = "a9d4e7c2b8f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    A new column on an existing table: its RLS policy and iot_app's grants
    already cover it. The connect flow keeps a one-time credential in the
    browser only while this matches (DESIGN.md §8), so a credential rotated
    elsewhere is never shown as current. Existing devices start at NULL:
    nothing in any browser was stored against them yet.
    """
    op.add_column(
        "devices",
        sa.Column("credential_rotated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("devices", "credential_rotated_at")
