"""create users table

Revision ID: 4bfef351a0df
Revises:
Create Date: 2026-07-29 17:36:43.725665

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4bfef351a0df"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    `users` is global (no tenant_id) — see app/auth/models.py's docstring for why
    it is not RLS-protected.
    """
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # No RLS here (see app/auth/models.py's docstring for why), but the
    # non-superuser `iot_app` role still needs an explicit grant to touch this
    # table at all — RLS and table privileges are separate mechanisms.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON users TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("users")
