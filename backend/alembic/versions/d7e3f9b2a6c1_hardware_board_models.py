"""hardware wiring names a board model, not a chip

Revision ID: d7e3f9b2a6c1
Revises: c5d2e8a4f1b7
Create Date: 2026-10-13T00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e3f9b2a6c1"
down_revision: str | Sequence[str] | None = "c5d2e8a4f1b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Chip ids saved before board models existed → the model they were wired for.
# The pin pools behind "esp32" were the 30-pin DevKit's, and "esp32c3" was the
# Super Mini's (frontend/src/lib/firmware-sketch.ts BOARDS).
_TO_MODEL = {"esp32": "esp32-devkit-30", "esp32c3": "esp32c3-supermini"}
_TABLES = ("device_catalog_entries", "devices")


def _remap(mapping: dict[str, str]) -> None:
    for table in _TABLES:
        for old, new in mapping.items():
            op.execute(
                f"UPDATE {table} SET hardware = jsonb_set(hardware, '{{board}}', '\"{new}\"') "
                f"WHERE hardware->>'board' = '{old}'"
            )


def upgrade() -> None:
    """Upgrade schema.

    Data only: hardware.board (JSONB, added in c5d2e8a4f1b7) now holds a board
    model id from firmware/boards.json. Runs as the migration role, so RLS
    doesn't hide any tenant's rows.
    """
    _remap(_TO_MODEL)


def downgrade() -> None:
    """Downgrade schema. Every model of a chip maps back to the chip id."""
    _remap({"esp32-devkit-30": "esp32", "esp32-devkit-38": "esp32", "esp32c3-supermini": "esp32c3"})
