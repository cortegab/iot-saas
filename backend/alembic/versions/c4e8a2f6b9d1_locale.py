"""locale: each person's language, and the workspace's for listed email addresses

Revision ID: c4e8a2f6b9d1
Revises: b7e3c9d1f4a6
Create Date: 2026-11-25T00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e8a2f6b9d1"
down_revision: str | Sequence[str] | None = "b7e3c9d1f4a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Spanish as a second language (DESIGN.md §11a). users.locale: a person's
    choice, null = follow their browser or phone; it also sets the language
    of their emails. tenants.locale: the language of emails to the listed
    alert addresses, which belong to no account. users and tenants are
    global tables (no tenant_id of their own), so no RLS policy is added.
    """
    op.add_column("users", sa.Column("locale", sa.String(), nullable=True))
    op.create_check_constraint(
        "ck_users_locale", "users", "locale IS NULL OR locale IN ('en', 'es')"
    )
    op.add_column("tenants", sa.Column("locale", sa.String(), nullable=False, server_default="en"))
    op.create_check_constraint("ck_tenants_locale", "tenants", "locale IN ('en', 'es')")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_tenants_locale", "tenants", type_="check")
    op.drop_column("tenants", "locale")
    op.drop_constraint("ck_users_locale", "users", type_="check")
    op.drop_column("users", "locale")
