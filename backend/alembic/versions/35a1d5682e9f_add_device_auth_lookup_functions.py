"""add device auth lookup functions

Revision ID: 35a1d5682e9f
Revises: e46006f41a46
Create Date: 2026-08-01 20:42:08.406391

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "35a1d5682e9f"
down_revision: str | Sequence[str] | None = "e46006f41a46"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Two narrow SECURITY DEFINER functions — the only sanctioned way to read
    `devices` without a tenant context already set. Both are owned by the
    migration role (`iot`, superuser), so they bypass RLS internally
    regardless of caller; only EXECUTE is granted to `iot_app`, and each
    returns only the columns its one caller needs. Everything else about
    `devices` stays exactly as RLS-protected as it was in
    d6309384a7aa_create_devices_table.py.

    Used by devices/service.py's lookup_device_for_auth (EMQX auth/authz
    callbacks, the HTTP ingest fallback — resolving a bare device id with no
    tenant context yet) and lookup_device_by_slug (MQTT topic segments ->
    real ids, in app.ingestion.service's directory cache).
    """
    op.execute(
        """
        CREATE FUNCTION lookup_device_for_auth(p_device_id uuid)
        RETURNS TABLE(
            tenant_id uuid,
            tenant_slug text,
            device_slug text,
            token_hash text,
            status text
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.tenant_id, t.slug, d.slug, d.token_hash, d.status
            FROM devices d
            JOIN tenants t ON t.id = d.tenant_id
            WHERE d.id = p_device_id
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION lookup_device_for_auth(uuid) TO iot_app")

    op.execute(
        """
        CREATE FUNCTION lookup_device_by_slug(p_tenant_slug text, p_device_slug text)
        RETURNS TABLE(tenant_id uuid, device_id uuid, status text)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.tenant_id, d.id, d.status
            FROM devices d
            JOIN tenants t ON t.id = d.tenant_id
            WHERE t.slug = p_tenant_slug AND d.slug = p_device_slug
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION lookup_device_by_slug(text, text) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS lookup_device_by_slug(text, text)")
    op.execute("DROP FUNCTION IF EXISTS lookup_device_for_auth(uuid)")
