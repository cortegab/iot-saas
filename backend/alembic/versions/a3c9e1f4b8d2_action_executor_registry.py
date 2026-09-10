"""action executor registry: email action type, failed-actions index, tenant notification_emails

Revision ID: a3c9e1f4b8d2
Revises: d2f4a8c6b193
Create Date: 2026-09-10T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "a3c9e1f4b8d2"
down_revision: str | Sequence[str] | None = "d2f4a8c6b193"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema (Phase 4 delivery half).

    - `action_executions.action_type` gains `'email'` — a delivered email is
      now its own execution-history row, distinct from the `notification`
      feed row that is still written on every firing.
    - Partial index for the tenant-wide failed-actions feed
      (`GET /rules/failed-actions`) — there was no `tenant_id` index on
      `action_executions` at all.
    - `tenants.notification_emails` — per-tenant recipient list for the
      notification `email` channel, editable from Settings -> Alerts. Empty
      list ⇒ fall back to owner/admin member emails (resolved in
      app.rules.service). `tenants` carries no RLS (see tenants/models.py),
      and `iot_app` already has UPDATE on it via the rename flow.
    """
    op.drop_constraint("ck_action_executions_action_type", "action_executions", type_="check")
    op.create_check_constraint(
        "ck_action_executions_action_type",
        "action_executions",
        "action_type IN ('actuator_command', 'webhook', 'notification', 'email', 'unknown')",
    )

    op.execute(
        "CREATE INDEX ix_action_executions_failed "
        "ON action_executions (tenant_id, created_at DESC) WHERE status = 'failed'"
    )

    op.add_column(
        "tenants",
        sa.Column(
            "notification_emails",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tenants", "notification_emails")
    op.execute("DROP INDEX IF EXISTS ix_action_executions_failed")
    op.execute("UPDATE action_executions SET action_type = 'unknown' WHERE action_type = 'email'")
    op.drop_constraint("ck_action_executions_action_type", "action_executions", type_="check")
    op.create_check_constraint(
        "ck_action_executions_action_type",
        "action_executions",
        "action_type IN ('actuator_command', 'webhook', 'notification', 'unknown')",
    )
