"""create telemetry hypertable

Revision ID: 625b5372be50
Revises: 35a1d5682e9f
Create Date: 2026-08-01 20:42:37.635703

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "625b5372be50"
down_revision: str | Sequence[str] | None = "35a1d5682e9f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    No primary key — TimescaleDB requires the partition column (`time`) in any
    unique constraint, and telemetry rows don't need individual identity
    (CLAUDE.md §5's schema has no `id` column). Create the plain table with its
    constraints first, then convert to a hypertable — the order TimescaleDB
    requires.

    Deliberately NO Row-Level Security here, unlike every other tenant-scoped
    table (CLAUDE.md §9.4's usual rule). Confirmed against this exact
    TimescaleDB version: `ALTER TABLE ... SET (timescaledb.compress, ...)`
    raises `FeatureNotSupportedError: compression cannot be used on table with
    row security` — a real, currently-unresolved TimescaleDB limitation
    (timescale/timescaledb#6827, #7830), not a workaround-able syntax issue;
    wrapping the table in a security-barrier view hits the identical
    restriction (timescale/timescaledb#6425). Compression was chosen over RLS
    for this one table (PLAN.md calls deferred compression "the single biggest
    cost risk in the project"); tenant isolation for telemetry is enforced at
    the application layer instead — every query in app/telemetry/service.py
    filters explicitly by tenant_id, and every write path (the worker's
    batched writer, the HTTP ingest fallback) already has a real, resolved
    tenant_id in hand before it ever touches this table. Every other table
    (devices, tenants, users, api_keys, refresh_tokens) keeps full RLS
    unchanged.
    """
    op.create_table(
        "telemetry",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
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
        sa.Column("value", sa.Float(), nullable=False),
    )
    op.execute("SELECT create_hypertable('telemetry', 'time')")
    op.execute(
        "CREATE INDEX ix_telemetry_tenant_device_metric_time "
        "ON telemetry (tenant_id, device_id, metric, time DESC)"
    )

    # Append-only: no UPDATE/DELETE grant. Telemetry rows are never edited or
    # removed except by the retention policy below, which runs as the table owner.
    op.execute("GRANT SELECT, INSERT ON telemetry TO iot_app")

    op.execute(
        "ALTER TABLE telemetry SET ("
        "timescaledb.compress, timescaledb.compress_segmentby = 'tenant_id, device_id'"
        ")"
    )
    op.execute("SELECT add_compression_policy('telemetry', INTERVAL '7 days')")
    # Provisional global default — becomes per-tenant when Phase 5 billing wires
    # plan-based retention (free: 7 days, paid: 90 days per CLAUDE.md §5).
    op.execute("SELECT add_retention_policy('telemetry', INTERVAL '90 days')")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("telemetry")
