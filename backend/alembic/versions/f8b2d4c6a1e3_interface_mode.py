"""interface mode: each person's Simple or Full view of a workspace

Revision ID: f8b2d4c6a1e3
Revises: e3c7a9f1b5d2
Create Date: 2026-11-24T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8b2d4c6a1e3"
down_revision: str | Sequence[str] | None = "e3c7a9f1b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Simple view (DESIGN.md §15a; ease-of-use plan C2): null means the role's
    default (Viewer: simple; Owner and Admin: full). tenant_memberships already
    carries tenant_id and its RLS policy; a new column needs neither.
    """
    op.add_column("tenant_memberships", sa.Column("interface_mode", sa.String(), nullable=True))
    op.create_check_constraint(
        "ck_tenant_memberships_interface_mode",
        "tenant_memberships",
        "interface_mode IS NULL OR interface_mode IN ('simple', 'full')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_tenant_memberships_interface_mode", "tenant_memberships", type_="check")
    op.drop_column("tenant_memberships", "interface_mode")
