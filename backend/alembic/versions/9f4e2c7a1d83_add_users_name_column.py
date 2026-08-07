"""add users name column

Revision ID: 9f4e2c7a1d83
Revises: f2a9c1d8b3e7
Create Date: 2026-08-07T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9f4e2c7a1d83"
down_revision: str | Sequence[str] | None = "f2a9c1d8b3e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Nullable — a display name is optional; the user menu falls back to email
    when absent. No RLS implications (see app/auth/models.py's docstring: users
    is a global table, already granted to iot_app in 4bfef351a0df).
    """
    op.add_column("users", sa.Column("name", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "name")
