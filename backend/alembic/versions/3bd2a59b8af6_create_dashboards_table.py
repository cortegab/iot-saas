"""create dashboards table

Revision ID: 3bd2a59b8af6
Revises: a1c3f7e9d2b4
Create Date: 2026-08-05 17:37:20.680391

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "3bd2a59b8af6"
down_revision: str | Sequence[str] | None = "a1c3f7e9d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Standard single-tenant RLS predicate — same template as
    4b5f22a89282_create_rules_table.py. `user_id` (personal ownership within
    a tenant) is enforced in app code, not a second RLS predicate — see
    app/dashboards/models.py's module docstring for why.
    """
    op.create_table(
        "dashboards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("layout", JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute("CREATE INDEX ix_dashboards_tenant_user ON dashboards (tenant_id, user_id)")

    op.execute("ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE dashboards FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON dashboards
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON dashboards")
    op.drop_table("dashboards")
