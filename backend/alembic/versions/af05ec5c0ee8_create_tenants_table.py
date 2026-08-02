"""create tenants table

Revision ID: af05ec5c0ee8
Revises: 4bfef351a0df
Create Date: 2026-07-29 17:36:44.170775

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "af05ec5c0ee8"
down_revision: str | Sequence[str] | None = "4bfef351a0df"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    `tenants` IS the tenant — no tenant_id (would be circular) and not
    RLS-protected directly; access is gated by always joining through
    tenant_memberships in tenants/service.py.
    """
    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # No RLS here (tenants/service.py gates access by joining through
    # tenant_memberships instead), but `iot_app` still needs an explicit grant.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("tenants")
