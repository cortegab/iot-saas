"""device health: status snapshot columns + per-metric health table

Revision ID: b3f7a1d94e26
Revises: e7b1c4a92f30
Create Date: 2026-09-04T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f7a1d94e26"
down_revision: str | Sequence[str] | None = "e7b1c4a92f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Two independent pieces (see docs/rule-engine-multi-device.md's Phase 2
    follow-up, CLAUDE.md §4's device-health topics):

    Tier A — a device-level scalar snapshot (rssi/battery/uptime/fw/last
    online-state), written directly and synchronously from app.worker's
    `_handle_status` on receipt of a retained `{tenant}/{device}/status`
    message. Same treatment `last_seen_at` already got: plain nullable
    columns on `devices`, no new RLS surface (the table is already
    RLS-protected). No SECURITY DEFINER function needed for the write path —
    unlike the batched storage-path flush, a single status message already
    carries a resolved tenant_id (via app.ingestion.service's device
    directory cache), so the worker can call app.db.set_tenant_context and
    do a plain scoped UPDATE, the same pattern app.commands.service.record_ack
    already uses for a worker-side single-row write.

    Tier B — per-(device, metric) freshness, needed for sensor-health display
    and for the rule evaluator's per-metric staleness bound (app.rules
    .evaluators.MetricValue.max_age_seconds). A new table, not new columns —
    unlike Tier A this write path *is* batched (inside stream_writer_loop's
    existing flush, next to touch_devices_last_seen), and a flush spans many
    tenants at once, so it needs its own SECURITY DEFINER upsert exactly like
    touch_devices_last_seen (a1c3f7e9d2b4) does for the single-timestamp case
    — this one takes parallel arrays because each row's value/metric differs,
    where touch_devices_last_seen could broadcast one shared timestamp.

    RLS policy is the standard single-tenant predicate, same template as
    f2a9c1d8b3e7_create_notifications_table.py.
    """
    op.add_column("devices", sa.Column("last_status_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_status_online", sa.Boolean(), nullable=True))
    op.add_column("devices", sa.Column("rssi", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("battery_pct", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("uptime_s", sa.Integer(), nullable=True))
    op.add_column("devices", sa.Column("fw_version", sa.String(), nullable=True))

    op.create_table(
        "device_metric_health",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "device_id", sa.Uuid(), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("device_id", "metric", name="uq_device_metric_health_device_metric"),
    )
    op.execute("CREATE INDEX ix_device_metric_health_tenant ON device_metric_health (tenant_id)")

    op.execute("ALTER TABLE device_metric_health ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE device_metric_health FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON device_metric_health
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON device_metric_health TO iot_app")

    op.execute(
        """
        CREATE FUNCTION upsert_device_metric_health(
            p_device_ids uuid[], p_metrics text[], p_values double precision[], p_seen_at timestamptz
        )
        RETURNS void
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            INSERT INTO device_metric_health (id, tenant_id, device_id, metric, last_value, last_seen_at, updated_at)
            SELECT gen_random_uuid(), d.tenant_id, u.device_id, u.metric, u.value, p_seen_at, now()
            FROM unnest(p_device_ids, p_metrics, p_values) AS u(device_id, metric, value)
            JOIN devices d ON d.id = u.device_id
            ON CONFLICT (device_id, metric) DO UPDATE
            SET last_value = EXCLUDED.last_value,
                last_seen_at = EXCLUDED.last_seen_at,
                updated_at = now()
            WHERE device_metric_health.last_seen_at IS NULL
               OR device_metric_health.last_seen_at < EXCLUDED.last_seen_at
        $$
        """
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION upsert_device_metric_health(uuid[], text[], double precision[], timestamptz) "
        "TO iot_app"
    )

    # Worker-side staleness-threshold derivation (app.health.service) needs
    # every active device's per-metric publish profile across all tenants at
    # once — same RLS-bypass rationale as list_enabled_rules (5b2d61c0d8b7):
    # the worker's session has no single tenant context.
    op.execute(
        """
        CREATE FUNCTION list_active_metric_publish_profiles()
        RETURNS TABLE(device_id uuid, metric text, publish text, publish_interval_seconds integer)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.id, m.value ->> 'key', COALESCE(m.value ->> 'publish', 'periodic'),
                   (m.value ->> 'publish_interval_seconds')::integer
            FROM devices d
            JOIN device_catalog_entries c ON c.id = d.catalog_entry_id
            CROSS JOIN LATERAL jsonb_array_elements(c.metrics) AS m(value)
            WHERE d.status = 'active'
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_active_metric_publish_profiles() TO iot_app")

    # Backs app.worker's config-publish fan-out (app.catalog.service
    # .CONFIG_PUBLISH_CHANNEL): given one catalog_entry_id, every active
    # device on it plus what the worker needs to publish a retained
    # {tenant}/{device}/config message — same RLS-bypass rationale as
    # lookup_rule_dispatch_targets (e7b1c4a92f30): the worker has no tenant
    # context, and results are still confined to one catalog entry (thus one
    # tenant) by the caller.
    op.execute(
        """
        CREATE FUNCTION list_devices_for_catalog_entry(p_catalog_entry_id uuid)
        RETURNS TABLE(device_id uuid, tenant_slug text, device_slug text, metrics jsonb)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.id, t.slug, d.slug, c.metrics
            FROM devices d
            JOIN device_catalog_entries c ON c.id = d.catalog_entry_id
            JOIN tenants t ON t.id = d.tenant_id
            WHERE c.id = p_catalog_entry_id AND d.status = 'active'
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_devices_for_catalog_entry(uuid) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS list_devices_for_catalog_entry(uuid)")
    op.execute("DROP FUNCTION IF EXISTS list_active_metric_publish_profiles()")
    op.execute(
        "DROP FUNCTION IF EXISTS upsert_device_metric_health(uuid[], text[], double precision[], timestamptz)"
    )
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON device_metric_health")
    op.drop_table("device_metric_health")
    op.drop_column("devices", "fw_version")
    op.drop_column("devices", "uptime_s")
    op.drop_column("devices", "battery_pct")
    op.drop_column("devices", "rssi")
    op.drop_column("devices", "last_status_online")
    op.drop_column("devices", "last_status_at")
