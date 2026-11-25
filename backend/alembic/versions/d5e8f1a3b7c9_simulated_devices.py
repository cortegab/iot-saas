"""simulated devices: a flag on devices and the worker's list of them

Revision ID: d5e8f1a3b7c9
Revises: c4e9a7b3d5f2
Create Date: 2026-11-24T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e8f1a3b7c9"
down_revision: str | Sequence[str] | None = "c4e9a7b3d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    A simulated device (ease-of-use plan B4) is an ordinary device whose
    readings the worker makes up (app.devices.simulator) and publishes through
    EMQX like a board would, so ingestion and the rules' hot path don't change.
    `devices` already carries tenant_id and its RLS policy; a new column needs
    neither a policy nor a grant.

    list_simulated_devices() backs the simulator: every active simulated device
    with what it needs to publish (tenant and device slugs, its template's
    metrics and actuators). SECURITY DEFINER for the same reason as
    list_active_metric_publish_profiles (b3f7a1d94e26): the worker has no
    single tenant context.
    """
    op.add_column(
        "devices",
        sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        CREATE FUNCTION list_simulated_devices()
        RETURNS TABLE(tenant_id uuid, tenant_slug text, device_id uuid, device_slug text, metrics jsonb, actuators jsonb)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.tenant_id, t.slug, d.id, d.slug, c.metrics, c.actuators
            FROM devices d
            JOIN device_catalog_entries c ON c.id = d.catalog_entry_id
            JOIN tenants t ON t.id = d.tenant_id
            WHERE d.simulated AND d.status = 'active'
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_simulated_devices() TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS list_simulated_devices()")
    op.drop_column("devices", "simulated")
