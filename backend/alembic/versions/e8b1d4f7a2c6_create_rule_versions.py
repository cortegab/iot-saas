"""create rule_versions table

Revision ID: e8b1d4f7a2c6
Revises: f1b7d3a9c5e2
Create Date: 2026-10-01T14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "e8b1d4f7a2c6"
down_revision: str | Sequence[str] | None = "f1b7d3a9c5e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Rule version history (DESIGN.md §9, §13): every create/update writes a
    snapshot of the saved rule plus human change lines, in the same
    transaction, from the API process — never the worker, never the hot path.
    Restore is client-side (load the snapshot into the draft, then a normal
    save). Tenant-scoped with the standard RLS predicate (CLAUDE.md §9.4).
    """
    op.create_table(
        "rule_versions",
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
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("change_lines", JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "author_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("rule_id", "version", name="uq_rule_versions_rule_version"),
    )
    op.execute("CREATE INDEX ix_rule_versions_rule ON rule_versions (rule_id, version DESC)")

    op.execute("ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE rule_versions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON rule_versions
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    # Append-only for the app role: versions are written, never edited. They
    # leave with their rule through the FK cascade.
    op.execute("GRANT SELECT, INSERT ON rule_versions TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON rule_versions")
    op.drop_table("rule_versions")
