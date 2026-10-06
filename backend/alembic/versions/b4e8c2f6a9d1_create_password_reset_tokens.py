"""create password_reset_tokens table

Revision ID: b4e8c2f6a9d1
Revises: a7d2e9c4b1f3
Create Date: 2026-09-30T19:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4e8c2f6a9d1"
down_revision: str | Sequence[str] | None = "a7d2e9c4b1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Forgot-password tokens. **No tenant_id and no RLS, deliberately**: a
    password belongs to a user, not a tenant, and the reset happens before
    any tenant is selected — the same reason `users` and `refresh_tokens`
    aren't tenant-scoped. CLAUDE.md §9.4's rule is for tenant data; this
    table holds none. Only a SHA-256 of the 32-byte random token is stored;
    tokens are single-use and short-lived (enforced in auth/service.py).
    """
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("CREATE INDEX ix_password_reset_tokens_user ON password_reset_tokens (user_id)")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("password_reset_tokens")
