"""create device catalog entries table

Revision ID: b7d3f8a2c1e9
Revises: 9f4e2c7a1d83
Create Date: 2026-08-07T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "b7d3f8a2c1e9"
down_revision: str | Sequence[str] | None = "9f4e2c7a1d83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Standard single-tenant RLS predicate — same template as
    3bd2a59b8af6_create_dashboards_table.py.

    devices.catalog_entry_id is backfilled rather than left nullable: every
    existing device is assigned a per-tenant "Legacy / Uncategorized" entry
    (empty metrics/actuators, preserving today's free-text-anything ingestion
    behavior) before the column is made NOT NULL, so no device — old or new —
    is ever without a catalog entry.
    """
    op.create_table(
        "device_catalog_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("metrics", JSONB(), nullable=False, server_default="[]"),
        sa.Column("actuators", JSONB(), nullable=False, server_default="[]"),
        sa.Column("is_legacy", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        "CREATE INDEX ix_device_catalog_entries_tenant ON device_catalog_entries (tenant_id)"
    )

    op.execute("ALTER TABLE device_catalog_entries ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE device_catalog_entries FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON device_catalog_entries
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON device_catalog_entries TO iot_app")

    # devices.catalog_entry_id: nullable first so the backfill below can run,
    # then tightened to NOT NULL once every row has a value. No ON DELETE
    # clause — Postgres's default RESTRICT means a catalog entry still
    # referenced by a device can't be deleted (see catalog/service.py's
    # CatalogEntryInUseError, which translates that into a clean 409).
    op.add_column(
        "devices",
        sa.Column(
            "catalog_entry_id",
            sa.Uuid(),
            sa.ForeignKey("device_catalog_entries.id"),
            nullable=True,
        ),
    )
    op.execute("CREATE INDEX ix_devices_catalog_entry ON devices (catalog_entry_id)")

    op.execute(
        """
        INSERT INTO device_catalog_entries (id, tenant_id, name, metrics, actuators, is_legacy, created_at, updated_at)
        SELECT gen_random_uuid(), t.id, 'Legacy / Uncategorized', '[]'::jsonb, '[]'::jsonb, true, now(), now()
        FROM tenants t
        WHERE EXISTS (SELECT 1 FROM devices d WHERE d.tenant_id = t.id)
        """
    )
    op.execute(
        """
        UPDATE devices d
        SET catalog_entry_id = c.id
        FROM device_catalog_entries c
        WHERE c.tenant_id = d.tenant_id AND c.is_legacy = true AND d.catalog_entry_id IS NULL
        """
    )
    op.alter_column("devices", "catalog_entry_id", nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_devices_catalog_entry", table_name="devices")
    op.drop_column("devices", "catalog_entry_id")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON device_catalog_entries")
    op.drop_table("device_catalog_entries")
