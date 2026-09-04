"""execution history: rule_executions + action_executions

Revision ID: d2f4a8c6b193
Revises: b3f7a1d94e26
Create Date: 2026-09-05T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "d2f4a8c6b193"
down_revision: str | Sequence[str] | None = "b3f7a1d94e26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Two new tables, same per-table shape as 327081b5010e_create_commands_table
    (create -> index -> RLS enable/force -> policy -> grant): rule_executions
    is one row per rule firing, written unconditionally by
    app.rules.service — decoupling "the rule fired" from "a notification
    exists" (notifications stays untouched; the two are parallel audit
    trails). action_executions is one row per action *attempt* within a
    firing, FK'd to rule_executions with ON DELETE CASCADE (child dies with
    its parent, unlike the SET NULL treatment used for FKs to long-lived
    resources like rules/devices/commands below).
    """
    op.create_table(
        "rule_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "rule_id", sa.Uuid(), sa.ForeignKey("rules.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "device_id", sa.Uuid(), sa.ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        "CREATE INDEX ix_rule_executions_rule_fired ON rule_executions (rule_id, fired_at DESC)"
    )
    op.execute("ALTER TABLE rule_executions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE rule_executions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON rule_executions
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    # Append/read-only — no UPDATE, no DELETE.
    op.execute("GRANT SELECT, INSERT ON rule_executions TO iot_app")

    op.create_table(
        "action_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "rule_execution_id",
            sa.Uuid(),
            sa.ForeignKey("rule_executions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action_type", sa.String(), nullable=False),
        sa.Column("action_index", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("detail", JSONB(), nullable=True),
        sa.Column(
            "command_id",
            sa.Uuid(),
            sa.ForeignKey("commands.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # Values are fully controlled by rules/service.py, never user input — cheap
    # belt-and-suspenders, not a hard need.
    op.create_check_constraint(
        "ck_action_executions_status", "action_executions", "status IN ('success', 'failed')"
    )
    op.create_check_constraint(
        "ck_action_executions_action_type",
        "action_executions",
        "action_type IN ('actuator_command', 'webhook', 'notification', 'unknown')",
    )
    op.execute(
        "CREATE INDEX ix_action_executions_rule_execution ON action_executions (rule_execution_id)"
    )
    op.execute("ALTER TABLE action_executions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE action_executions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON action_executions
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT ON action_executions TO iot_app")


def downgrade() -> None:
    """Downgrade schema.

    Trivial and non-lossy — brand-new tables, nothing to preserve. Child
    before parent for the FK.
    """
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON action_executions")
    op.drop_table("action_executions")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON rule_executions")
    op.drop_table("rule_executions")
