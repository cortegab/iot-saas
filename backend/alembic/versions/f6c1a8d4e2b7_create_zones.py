"""create zones table and devices.zone_id

Revision ID: f6c1a8d4e2b7
Revises: e5b9c3d7f2a4
Create Date: 2026-09-30T18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6c1a8d4e2b7"
down_revision: str | Sequence[str] | None = "e5b9c3d7f2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Zones (DESIGN.md §8, §13): name + notes per tenant, with the standard
    single-tenant RLS predicate (CLAUDE.md §9.4 — same template as
    f2a9c1d8b3e7_create_notifications_table.py). Devices get a nullable
    `zone_id`; RESTRICT backs up the service's "blocked while assigned" check.
    """
    op.create_table(
        "zones",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute("CREATE UNIQUE INDEX uq_zones_tenant_lower_name ON zones (tenant_id, lower(name))")

    op.execute("ALTER TABLE zones ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE zones FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON zones
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON zones TO iot_app")

    op.add_column(
        "devices",
        sa.Column(
            "zone_id",
            sa.Uuid(),
            sa.ForeignKey("zones.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.execute("CREATE INDEX ix_devices_zone_id ON devices (zone_id)")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_devices_zone_id")
    op.drop_column("devices", "zone_id")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON zones")
    op.drop_table("zones")
