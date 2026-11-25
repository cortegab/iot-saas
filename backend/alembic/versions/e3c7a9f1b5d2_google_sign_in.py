"""google sign-in: accounts without a password, and their Google subject

Revision ID: e3c7a9f1b5d2
Revises: d5e8f1a3b7c9
Create Date: 2026-11-24T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3c7a9f1b5d2"
down_revision: str | Sequence[str] | None = "d5e8f1a3b7c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Sign in with Google (ease-of-use plan B5): an account made from a Google
    ID token has no password until its owner sets one through "forgot
    password", so password_hash becomes nullable; google_sub is Google's
    stable id for the person (the token's `sub`), unique, set when they first
    sign in with Google. `users` stays global (no tenant_id), as created in
    4bfef351a0df: its grants already cover new columns.
    """
    op.alter_column("users", "password_hash", existing_type=sa.String(), nullable=True)
    op.add_column("users", sa.Column("google_sub", sa.String(), nullable=True))
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])


def downgrade() -> None:
    """Downgrade schema. Google-only accounts (no password) can't survive it."""
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
    op.execute("DELETE FROM users WHERE password_hash IS NULL")
    op.alter_column("users", "password_hash", existing_type=sa.String(), nullable=False)
