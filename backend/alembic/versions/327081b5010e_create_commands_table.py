"""create commands table

Revision ID: 327081b5010e
Revises: 4b5f22a89282
Create Date: 2026-08-03 18:26:19.230218

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "327081b5010e"
down_revision: str | Sequence[str] | None = "4b5f22a89282"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    `id` doubles as the command_id carried in the MQTT command payload
    (CLAUDE.md §4). Standard single-tenant RLS predicate, same template as
    rules/devices — low volume, never compressed, no conflict with
    telemetry's RLS/compression tradeoff.
    """
    op.create_table(
        "commands",
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
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actuator", sa.String(), nullable=False),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute("CREATE INDEX ix_commands_device_published ON commands (device_id, published_at DESC)")

    op.execute("ALTER TABLE commands ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE commands FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON commands
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    # UPDATE needed for acked_at; no DELETE — audit log is append/update-only.
    op.execute("GRANT SELECT, INSERT, UPDATE ON commands TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON commands")
    op.drop_table("commands")
