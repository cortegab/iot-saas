"""no wiring is SQL NULL, not the JSON value null

Revision ID: e4a8c2f6b9d3
Revises: d7e3f9b2a6c1
Create Date: 2026-10-13T00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a8c2f6b9d3"
down_revision: str | Sequence[str] | None = "d7e3f9b2a6c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Data only. Until the models said JSONB(none_as_null=True), clearing the
    wiring stored the JSON value `null`, so `hardware IS NOT NULL` was true for
    templates and devices with no wiring. The app read both the same way;
    queries didn't. Runs as the migration role, so RLS hides no tenant's rows.
    """
    for table in ("device_catalog_entries", "devices"):
        op.execute(f"UPDATE {table} SET hardware = NULL WHERE hardware = 'null'::jsonb")


def downgrade() -> None:
    """Downgrade schema. Nothing to undo: SQL NULL means the same thing."""
