"""create telemetry continuous aggregates

Revision ID: 49d238bf9bea
Revises: 625b5372be50
Create Date: 2026-08-01 20:43:04.049970

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "49d238bf9bea"
down_revision: str | Sequence[str] | None = "625b5372be50"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VIEWS = (
    ("telemetry_1m", "1 minute", "1 hour", "1 minute"),
    ("telemetry_1h", "1 hour", "1 day", "1 hour"),
)


def upgrade() -> None:
    """Upgrade schema.

    1-minute and 1-hour rollups (CLAUDE.md §5) — dashboards query these, never
    raw telemetry. `materialized_only = false` is TimescaleDB's default; set
    explicitly because it's what makes these views include data since the last
    refresh, not just fully-materialized buckets.

    No RLS here either, for consistency with the raw `telemetry` table (see
    625b5372be50's docstring for why — TimescaleDB compression and RLS can't
    coexist on the same hypertable, confirmed against this exact version).
    These aggregates are downstream of the same uncompressed-if-RLS'd data and
    will want their own compression eventually; keeping the whole telemetry
    subsystem consistently application-filtered (app/telemetry/service.py
    filters every query by tenant_id explicitly) avoids a confusing split
    where raw rows are trusted at the app layer but rollups aren't.
    """
    for view_name, bucket, start_offset, schedule_interval in _VIEWS:
        op.execute(
            f"""
            CREATE MATERIALIZED VIEW {view_name}
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('{bucket}', time) AS bucket,
                tenant_id,
                device_id,
                metric,
                avg(value) AS avg_value
            FROM telemetry
            GROUP BY bucket, tenant_id, device_id, metric
            WITH NO DATA
            """
        )
        op.execute(
            f"""
            SELECT add_continuous_aggregate_policy('{view_name}',
                start_offset => INTERVAL '{start_offset}',
                end_offset => INTERVAL '{bucket}',
                schedule_interval => INTERVAL '{schedule_interval}')
            """
        )
        op.execute(f"ALTER MATERIALIZED VIEW {view_name} SET (timescaledb.materialized_only = false)")
        op.execute(f"GRANT SELECT ON {view_name} TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    for view_name, *_ in reversed(_VIEWS):
        op.execute(f"DROP MATERIALIZED VIEW IF EXISTS {view_name} CASCADE")
