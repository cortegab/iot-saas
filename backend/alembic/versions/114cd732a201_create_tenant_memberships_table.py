"""create tenant_memberships table

Revision ID: 114cd732a201
Revises: af05ec5c0ee8
Create Date: 2026-07-29 17:36:44.595632

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "114cd732a201"
down_revision: str | Sequence[str] | None = "af05ec5c0ee8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    This is where tenant isolation actually lives (tenants/users themselves are
    not RLS-protected — see their own migrations). The policy uses a DUAL
    predicate, not the single-tenant-context pattern every other tenant-scoped
    table uses:

      - `user_id = app.user_id`   -> lets a caller list every tenant they belong
        to (e.g. right after login), before any tenant has been selected.
      - `tenant_id = app.tenant_id` -> lets a caller list every member of the
        tenant currently in context (e.g. a team-management screen).

    WITH CHECK only allows the tenant_id branch: a membership row can only be
    inserted while already inside that tenant's context. The one exception is
    tenant *creation*, where tenants/service.py sets tenant context itself,
    immediately after creating the tenant, before inserting the owner row.
    """
    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_memberships_tenant_user"),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'viewer')", name="ck_tenant_memberships_role"
        ),
    )

    op.execute("ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY membership_access ON tenant_memberships
          USING (
            user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          )
          WITH CHECK (
            tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
          )
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_memberships TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS membership_access ON tenant_memberships")
    op.drop_table("tenant_memberships")
