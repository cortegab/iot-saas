"""tenants.timezone

Revision ID: d2a6f8b3c7e4
Revises: c9f3a7e1d5b2
Create Date: 2026-09-30T20:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2a6f8b3c7e4"
down_revision: str | Sequence[str] | None = "c9f3a7e1d5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    `tenants.timezone` (IANA name, default UTC): the workspace time zone — the
    default for new schedules and for showing times (DESIGN.md §8). A column on
    an existing table, so no new RLS policy; `tenants` access is gated at the
    route layer as before.
    """
    op.add_column(
        "tenants", sa.Column("timezone", sa.String(), nullable=False, server_default="UTC")
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tenants", "timezone")
