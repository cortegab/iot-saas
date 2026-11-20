"""device ota keys

Revision ID: a9d4e2c6f8b1
Revises: f1a7c3e9b2d4
Create Date: 2026-11-19T23:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9d4e2c6f8b1"
down_revision: str | Sequence[str] | None = "f1a7c3e9b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    The update keys a device's firmware trusts (status message `ota_keys`,
    generic firmware 1.0.1+). A column on `devices` (tenant_id and RLS already
    in place): app.firmware offers an update only when the key that signed it
    is among them.
    """
    op.add_column(
        "devices", sa.Column("ota_keys", postgresql.JSONB(none_as_null=True), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("devices", "ota_keys")
