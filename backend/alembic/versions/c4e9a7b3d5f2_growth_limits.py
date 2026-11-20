"""growth limits: rollup retention and history pruning

Revision ID: c4e9a7b3d5f2
Revises: b2c8e4f6a1d3
Create Date: 2026-11-20T00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e9a7b3d5f2"
down_revision: str | Sequence[str] | None = "b2c8e4f6a1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Storage discipline (CLAUDE.md §5): raw telemetry already keeps 90 days;
    its rollups had no limit. The 1-minute rollup keeps 180 days, the 1-hour
    one 3 years.

    prune_history(before) deletes old history the dashboards and editors no
    longer show: rule executions (their action rows go with them), commands,
    and notifications someone has read or dismissed. Unread ones stay. Called
    nightly by the worker (app.worker.pruning_loop); SECURITY DEFINER because
    the worker has no tenant context, and it only ever deletes by age.
    """
    op.execute(
        "SELECT add_retention_policy('telemetry_1m', INTERVAL '180 days', if_not_exists => true)"
    )
    op.execute(
        "SELECT add_retention_policy('telemetry_1h', INTERVAL '3 years', if_not_exists => true)"
    )
    op.execute(
        """
        CREATE FUNCTION prune_history(p_before timestamptz)
        RETURNS TABLE(rule_executions bigint, commands bigint, notifications bigint)
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        DECLARE
            n_exec bigint;
            n_cmd bigint;
            n_notif bigint;
        BEGIN
            DELETE FROM rule_executions WHERE created_at < p_before;
            GET DIAGNOSTICS n_exec = ROW_COUNT;
            DELETE FROM commands WHERE issued_at < p_before;
            GET DIAGNOSTICS n_cmd = ROW_COUNT;
            DELETE FROM notifications
            WHERE created_at < p_before AND (read_at IS NOT NULL OR dismissed_at IS NOT NULL);
            GET DIAGNOSTICS n_notif = ROW_COUNT;
            RETURN QUERY SELECT n_exec, n_cmd, n_notif;
        END
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION prune_history(timestamptz) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS prune_history(timestamptz)")
    op.execute("SELECT remove_retention_policy('telemetry_1h', if_exists => true)")
    op.execute("SELECT remove_retention_policy('telemetry_1m', if_exists => true)")
