"""create push_devices

Revision ID: b3e8f1a5c7d2
Revises: d4b8e2a6f1c3
Create Date: 2026-11-07T16:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e8f1a5c7d2"
down_revision: str | Sequence[str] | None = "d4b8e2a6f1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Phones that receive push notifications (app.push): one FCM token per app
    install per workspace, owned by the signed-in user. Standard single-tenant
    RLS predicate (CLAUDE.md §9.4, same template as create_zones).
    """
    op.create_table(
        "push_devices",
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
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("min_severity", sa.String(), server_default="warning", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("tenant_id", "token", name="uq_push_devices_tenant_token"),
        sa.CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
        sa.CheckConstraint(
            "min_severity IN ('critical', 'warning')", name="ck_push_devices_min_severity"
        ),
    )
    op.execute("CREATE INDEX ix_push_devices_tenant_user ON push_devices (tenant_id, user_id)")

    op.execute("ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE push_devices FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON push_devices
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON push_devices TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON push_devices")
    op.drop_table("push_devices")
