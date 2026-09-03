"""multi-device rules

Revision ID: e7b1c4a92f30
Revises: a2f6c9e1b4d8
Create Date: 2026-09-01T00:00:00.000000

"""

import json
import re
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "e7b1c4a92f30"
down_revision: str | Sequence[str] | None = "a2f6c9e1b4d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_OPERATOR_WORDS = {
    ">": "above",
    ">=": "at or above",
    "<": "below",
    "<=": "at or below",
    "==": "equal to",
    "!=": "different from",
}


def _stamp_device(node: dict[str, Any], device_id: str) -> dict[str, Any]:
    """Recursively add `device_id` to every leaf of a condition tree — the
    pre-multi-device leaves had no device dimension, they implicitly meant
    "this rule's one device".
    """
    if node.get("kind") == "leaf":
        return {**node, "device_id": device_id}
    return {
        **node,
        "predicates": [_stamp_device(child, device_id) for child in node["predicates"]],
    }


def _summarize(node: dict[str, Any]) -> str:
    if node.get("kind") == "leaf":
        word = _OPERATOR_WORDS.get(node["operator"], node["operator"])
        return f"{node['metric']} {word} {node['threshold']}"
    joiner = " and " if node["op"] == "AND" else " or "
    return joiner.join(_summarize(child) for child in node["predicates"])


def _name_from(node: dict[str, Any]) -> str:
    summary = _summarize(node)
    summary = summary[0].upper() + summary[1:] if summary else "Rule"
    return re.sub(r"\s+", " ", summary)[:200]


def upgrade() -> None:
    """Upgrade schema.

    Makes a rule independent of a single device (the advanced multi-device
    rule engine, Phase 1):

    - `condition` leaves now carry their own `device_id` (backfilled from the
      rule's old single `device_id`) so a tree can reference several devices.
    - a single `action` becomes an `actions` JSONB array.
    - `for_duration`/`cooldown` fold into an `execution_policy` JSONB (with a
      `strategy` discriminator — "edge" today, "continuous"/"reset_condition"
      later), the same flatten-to-JSONB move `c3f8b1e6a4d7` made for the
      condition tree.
    - `trigger` JSONB is added (metric-arrival only for now).
    - `rules.device_id` stays as a nullable convenience pointer to the
      primary input device (SET NULL on delete, no longer CASCADE — deleting
      one input device must not silently delete a rule that also reads
      others).
    - `rule_devices` records every (rule, device, role) pair for referential
      integrity, the "which rules touch device X" query, and tenant-scoped
      validation. The hot-path cache does NOT read it — the condition tree is
      self-describing — but CRUD keeps it in sync.

    Every existing row backfills into the trivial single-device shape, so no
    rule's behaviour changes.
    """
    op.create_table(
        "rule_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rule_id",
            sa.Uuid(),
            sa.ForeignKey("rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            sa.Uuid(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("role IN ('input', 'target')", name="ck_rule_devices_role"),
        sa.UniqueConstraint("rule_id", "device_id", "role", name="uq_rule_devices_rule_device_role"),
    )
    op.execute("CREATE INDEX ix_rule_devices_tenant ON rule_devices (tenant_id)")
    op.execute("CREATE INDEX ix_rule_devices_rule ON rule_devices (rule_id)")
    op.execute("CREATE INDEX ix_rule_devices_device ON rule_devices (device_id, role)")
    op.execute("ALTER TABLE rule_devices ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE rule_devices FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON rule_devices
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON rule_devices TO iot_app")

    # New rules columns — nullable first so the backfill can run.
    op.add_column("rules", sa.Column("name", sa.String(), nullable=True))
    op.add_column("rules", sa.Column("description", sa.String(), nullable=True))
    op.add_column("rules", sa.Column("trigger", JSONB(), nullable=True))
    op.add_column("rules", sa.Column("actions", JSONB(), nullable=True))
    op.add_column("rules", sa.Column("execution_policy", JSONB(), nullable=True))
    op.add_column("rules", sa.Column("editor_graph", JSONB(), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id, tenant_id, device_id, condition, action, for_duration, cooldown FROM rules"
        )
    ).fetchall()
    for row in rows:
        device_id = str(row.device_id)
        condition = _stamp_device(row.condition, device_id)
        policy = {
            "strategy": "edge",
            "for_duration": row.for_duration,
            "cooldown": row.cooldown,
            "reset_condition": None,
        }
        conn.execute(
            text(
                "UPDATE rules SET "
                "condition = CAST(:condition AS jsonb), "
                "name = :name, "
                "trigger = CAST('{\"type\": \"metric\"}' AS jsonb), "
                "actions = CAST(:actions AS jsonb), "
                "execution_policy = CAST(:policy AS jsonb) "
                "WHERE id = :id"
            ),
            {
                "condition": json.dumps(condition),
                "name": _name_from(condition),
                "actions": json.dumps([row.action]),
                "policy": json.dumps(policy),
                "id": row.id,
            },
        )
        conn.execute(
            text(
                "INSERT INTO rule_devices (id, tenant_id, rule_id, device_id, role, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :tenant_id, :rule_id, :device_id, 'input', now(), now())"
            ),
            {"tenant_id": row.tenant_id, "rule_id": row.id, "device_id": row.device_id},
        )
        if isinstance(row.action, dict) and row.action.get("type") == "actuator_command":
            conn.execute(
                text(
                    "INSERT INTO rule_devices (id, tenant_id, rule_id, device_id, role, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :rule_id, :device_id, 'target', now(), now()) "
                    "ON CONFLICT ON CONSTRAINT uq_rule_devices_rule_device_role DO NOTHING"
                ),
                {"tenant_id": row.tenant_id, "rule_id": row.id, "device_id": row.device_id},
            )

    op.alter_column("rules", "name", nullable=False)
    op.alter_column("rules", "trigger", nullable=False)
    op.alter_column("rules", "actions", nullable=False)
    op.alter_column("rules", "execution_policy", nullable=False)

    # `device_id` was a single-device pointer. A rule now relates to N devices
    # only through `rule_devices` (backfilled above), so drop it — this also
    # drops rules_device_id_fkey.
    op.drop_index("ix_rules_device", table_name="rules")
    op.drop_column("rules", "device_id")

    op.drop_column("rules", "action")
    op.drop_column("rules", "for_duration")
    op.drop_column("rules", "cooldown")
    op.execute("ALTER TABLE rules DROP CONSTRAINT IF EXISTS ck_rules_type")

    # SETOF rules resolves the table rowtype at CREATE time — recreate it now
    # that the columns changed (same escape hatch as 5b2d61c0d8b7).
    op.execute("DROP FUNCTION IF EXISTS list_enabled_rules()")
    op.execute(
        """
        CREATE FUNCTION list_enabled_rules()
        RETURNS SETOF rules
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT * FROM rules WHERE enabled = true
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_enabled_rules() TO iot_app")

    # An action can target a device other than the one that triggered the
    # rule — the worker has no tenant context, so it resolves the target's
    # topic slugs through this narrow SECURITY DEFINER function (same pattern
    # as lookup_device_by_slug). Results are still confined to one tenant by
    # the caller passing only that rule's own device ids.
    op.execute(
        """
        CREATE FUNCTION lookup_rule_dispatch_targets(p_device_ids uuid[])
        RETURNS TABLE(device_id uuid, tenant_id uuid, tenant_slug text, device_slug text, status text)
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT d.id, d.tenant_id, t.slug, d.slug, d.status
            FROM devices d
            JOIN tenants t ON t.id = d.tenant_id
            WHERE d.id = ANY(p_device_ids)
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION lookup_rule_dispatch_targets(uuid[]) TO iot_app")


def downgrade() -> None:
    """Downgrade schema.

    Best-effort, matching this repo's other migrations: only faithful for a
    rule with exactly one input device and one action (every rule that
    existed before this migration ran). A genuine multi-device rule has no
    flat equivalent — its extra input devices and extra actions are dropped.
    """
    op.execute("DROP FUNCTION IF EXISTS lookup_rule_dispatch_targets(uuid[])")
    op.execute("DROP FUNCTION IF EXISTS list_enabled_rules()")

    op.add_column("rules", sa.Column("action", JSONB(), nullable=True))
    op.add_column(
        "rules", sa.Column("for_duration", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("rules", sa.Column("cooldown", sa.Integer(), nullable=False, server_default="0"))
    op.execute(
        """
        UPDATE rules SET
            action = actions->0,
            for_duration = COALESCE((execution_policy->>'for_duration')::int, 0),
            cooldown = COALESCE((execution_policy->>'cooldown')::int, 0)
        """
    )
    op.alter_column("rules", "action", nullable=False)

    op.add_column("rules", sa.Column("device_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE rules r SET device_id = (
            SELECT rd.device_id FROM rule_devices rd
            WHERE rd.rule_id = r.id AND rd.role = 'input'
            ORDER BY rd.created_at
            LIMIT 1
        )
        """
    )
    op.execute("DELETE FROM rules WHERE device_id IS NULL")
    op.alter_column("rules", "device_id", nullable=False)
    op.create_foreign_key(
        "rules_device_id_fkey", "rules", "devices", ["device_id"], ["id"], ondelete="CASCADE"
    )
    op.execute("CREATE INDEX ix_rules_device ON rules (device_id)")

    op.drop_column("rules", "editor_graph")
    op.drop_column("rules", "execution_policy")
    op.drop_column("rules", "actions")
    op.drop_column("rules", "trigger")
    op.drop_column("rules", "description")
    op.drop_column("rules", "name")

    op.execute(
        """
        CREATE FUNCTION list_enabled_rules()
        RETURNS SETOF rules
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT * FROM rules WHERE enabled = true
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_enabled_rules() TO iot_app")

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON rule_devices")
    op.drop_table("rule_devices")
