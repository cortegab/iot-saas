"""command expiry and who sent it

Revision ID: f1a7c3e9b2d4
Revises: d8f3b0c5e2a7
Create Date: 2026-11-19T22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a7c3e9b2d4"
down_revision: str | Sequence[str] | None = "d8f3b0c5e2a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    `commands` (tenant_id and RLS already in place) gains:
    - `expired_at`: set by the worker once a command passed its TTL with no
      ack ("No response", stored instead of worked out in the browser);
    - `requested_by`: the person who sent a manual command (null for rules).

    expire_unacked_commands() is the worker's one cross-tenant step (it has
    no tenant context, same escape hatch as list_enabled_rules): it marks the
    overdue commands and returns, for each one that is still the latest
    command to its actuator, the last acknowledged value and the topic slugs,
    so the worker can put the retained desired state back to it.
    """
    op.add_column("commands", sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "commands",
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_commands_unacked_open",
        "commands",
        ["issued_at"],
        postgresql_where=sa.text("acked_at IS NULL AND expired_at IS NULL"),
    )
    op.execute(
        """
        CREATE FUNCTION expire_unacked_commands(p_now timestamptz)
        RETURNS TABLE(
            command_id uuid, tenant_id uuid, device_id uuid, actuator text,
            tenant_slug text, device_slug text, is_latest boolean,
            has_acked_value boolean, acked_value jsonb
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            WITH expired AS (
                UPDATE commands c
                SET expired_at = p_now
                WHERE c.acked_at IS NULL
                  AND c.expired_at IS NULL
                  AND c.issued_at + make_interval(secs => c.ttl_seconds) < p_now
                RETURNING c.id, c.tenant_id, c.device_id, c.actuator, c.issued_at
            )
            SELECT
                e.id, e.tenant_id, e.device_id, e.actuator, t.slug, d.slug,
                NOT EXISTS (
                    SELECT 1 FROM commands n
                    WHERE n.device_id = e.device_id AND n.actuator = e.actuator
                      AND n.issued_at > e.issued_at
                ),
                la.value IS NOT NULL,
                la.value
            FROM expired e
            JOIN devices d ON d.id = e.device_id
            JOIN tenants t ON t.id = e.tenant_id
            LEFT JOIN LATERAL (
                SELECT a.value FROM commands a
                WHERE a.device_id = e.device_id AND a.actuator = e.actuator
                  AND a.acked_at IS NOT NULL
                ORDER BY a.issued_at DESC
                LIMIT 1
            ) la ON true
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION expire_unacked_commands(timestamptz) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS expire_unacked_commands(timestamptz)")
    op.drop_index("ix_commands_unacked_open", table_name="commands")
    op.drop_column("commands", "requested_by")
    op.drop_column("commands", "expired_at")
