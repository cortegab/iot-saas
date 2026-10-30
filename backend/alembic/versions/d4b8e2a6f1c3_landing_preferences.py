"""where each member lands: default dashboard, welcome, setup dismissed

Revision ID: d4b8e2a6f1c3
Revises: c3e8a1f5d2b9
Create Date: 2026-10-29T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4b8e2a6f1c3"
down_revision: str | Sequence[str] | None = "c3e8a1f5d2b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    New columns on existing tables: their RLS policies and iot_app's grants
    already cover them. Dashboards are per person, so the default lives on
    the membership (one per person per workspace) and goes back to NULL when
    that dashboard is deleted. Dismissing Get started is workspace-wide.
    """
    op.add_column(
        "tenant_memberships",
        sa.Column(
            "default_dashboard_id",
            sa.Uuid(),
            sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "tenant_memberships",
        sa.Column("welcomed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("setup_dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tenants", "setup_dismissed_at")
    op.drop_column("tenant_memberships", "welcomed_at")
    op.drop_column("tenant_memberships", "default_dashboard_id")
