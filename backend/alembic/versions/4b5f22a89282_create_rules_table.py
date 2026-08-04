"""create rules table

Revision ID: 4b5f22a89282
Revises: 49d238bf9bea
Create Date: 2026-08-03 18:26:07.670603

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "4b5f22a89282"
down_revision: str | Sequence[str] | None = "49d238bf9bea"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Standard single-tenant RLS predicate — same template as
    d6309384a7aa_create_devices_table.py. Small table, never compressed, so
    (unlike telemetry) there's no RLS/compression conflict here.
    """
    op.create_table(
        "rules",
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
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False, server_default="threshold"),
        sa.Column("operator", sa.String(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("for_duration", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hysteresis", sa.Float(), nullable=False, server_default="0"),
        sa.Column("action", JSONB(), nullable=False),
        sa.Column("cooldown", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("type IN ('threshold')", name="ck_rules_type"),
        sa.CheckConstraint(
            "operator IN ('>', '>=', '<', '<=', '==', '!=')", name="ck_rules_operator"
        ),
    )
    op.execute("CREATE INDEX ix_rules_device_metric ON rules (device_id, metric)")

    op.execute("ALTER TABLE rules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE rules FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON rules
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON rules TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON rules")
    op.drop_table("rules")
