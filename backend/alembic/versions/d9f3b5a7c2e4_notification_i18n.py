"""notification i18n: a message key and values, so each reader sees it in their language

Revision ID: d9f3b5a7c2e4
Revises: c4e8a2f6b9d1
Create Date: 2026-11-25T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d9f3b5a7c2e4"
down_revision: str | Sequence[str] | None = "c4e8a2f6b9d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Spanish plan L8 (DESIGN.md §11a): notifications are per workspace, read
    by people in different languages, so the platform's own texts are also
    stored as {"message": {"key", "params"}, "detail": {...}} for the clients
    to word. `message` / `detail` keep the English text (grouping, older rows
    and user-written messages). notifications already has tenant_id and its
    RLS policy; a new column needs neither.
    """
    op.add_column("notifications", sa.Column("i18n", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("notifications", "i18n")
