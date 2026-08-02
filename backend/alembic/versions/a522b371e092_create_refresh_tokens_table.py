"""create refresh_tokens table

Revision ID: a522b371e092
Revises: 114cd732a201
Create Date: 2026-07-29 17:41:16.664654

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a522b371e092"
down_revision: str | Sequence[str] | None = "114cd732a201"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Belongs to a user, not a tenant — a login session isn't tenant-specific
    (tenant is chosen per-request via X-Tenant-Id, never baked into a token).
    No tenant_id, no RLS; scoped by user_id in auth/service.py.
    """
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])
    # No RLS here (see app/auth/models.py's docstring for why — scoped by
    # user_id in auth/service.py instead), but `iot_app` still needs a grant.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("refresh_tokens")
