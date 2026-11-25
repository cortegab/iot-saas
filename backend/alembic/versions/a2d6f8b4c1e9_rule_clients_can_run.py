"""rules.clients_can_run: scenes a Viewer may press

Revision ID: a2d6f8b4c1e9
Revises: f8b2d4c6a1e3
Create Date: 2026-11-25T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2d6f8b4c1e9"
down_revision: str | Sequence[str] | None = "f8b2d4c6a1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Scenes (DESIGN.md §15a; ease-of-use plan C5): a rule with a manual trigger
    that an admin opens to clients, so a Viewer can run it ("Night mode").
    Off by default. `rules` already carries tenant_id and its RLS policy.
    """
    op.add_column(
        "rules",
        sa.Column("clients_can_run", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("rules", "clients_can_run")
