"""create notifications table

Revision ID: f2a9c1d8b3e7
Revises: 3bd2a59b8af6
Create Date: 2026-08-06T21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a9c1d8b3e7"
down_revision: str | Sequence[str] | None = "3bd2a59b8af6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Standard single-tenant RLS predicate — same template as
    3bd2a59b8af6_create_dashboards_table.py. Tenant-wide, not per-user (see
    app/notifications/models.py's module docstring for why).
    """
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            sa.Uuid(),
            sa.ForeignKey("devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "rule_id",
            sa.Uuid(),
            sa.ForeignKey("rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "CREATE INDEX ix_notifications_tenant_created ON notifications (tenant_id, created_at DESC)"
    )

    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notifications FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON notifications
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON notifications")
    op.drop_table("notifications")
