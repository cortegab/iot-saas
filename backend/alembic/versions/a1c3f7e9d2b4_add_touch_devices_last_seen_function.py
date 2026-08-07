"""add touch_devices_last_seen function

Revision ID: a1c3f7e9d2b4
Revises: 5b2d61c0d8b7
Create Date: 2026-08-04 18:05:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3f7e9d2b4"
down_revision: str | Sequence[str] | None = "5b2d61c0d8b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    A third SECURITY DEFINER function alongside 35a1d5682e9f's two — same
    rationale: the worker's session never has a tenant context set (there is
    no single tenant for a batched multi-tenant flush), so a plain UPDATE
    against RLS-protected `devices` would silently touch zero rows. Called
    from app.worker's stream_writer_loop flush(), batched with the rest of
    that flush rather than per-message, so this never sits on the hot path
    (CLAUDE.md §9 constraint 1).

    The `last_seen_at IS NULL OR last_seen_at < seen_at` guard makes repeated
    or out-of-order calls idempotent — a flush can never regress a device's
    last-seen time backwards.
    """
    op.execute(
        """
        CREATE FUNCTION touch_devices_last_seen(p_ids uuid[], p_seen_at timestamptz)
        RETURNS void
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            UPDATE devices
            SET last_seen_at = p_seen_at
            WHERE id = ANY(p_ids) AND (last_seen_at IS NULL OR last_seen_at < p_seen_at)
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION touch_devices_last_seen(uuid[], timestamptz) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS touch_devices_last_seen(uuid[], timestamptz)")
