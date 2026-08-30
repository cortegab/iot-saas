"""backfill catalog entry metric/actuator keys

Revision ID: a2f6c9e1b4d8
Revises: d4a6e9c2f1b8
Create Date: 2026-08-25T00:00:00.000000

"""

import json
import re
from collections.abc import Sequence
from typing import Any

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a2f6c9e1b4d8"
down_revision: str | Sequence[str] | None = "d4a6e9c2f1b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Copied rather than imported from app.shared.slug — migrations stay frozen
# in time and independent of the application package, matching every other
# migration in this repo (none imports from `app.*`).
def _slugify(name: str, fallback: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return base or fallback


def _normalize(items: list[dict[str, Any]], fallback_prefix: str) -> list[dict[str, Any]]:
    """Fill in a blank `key` from a slugified `name`, deduping
    case-insensitively against every key already present (explicit or
    already-assigned in this pass) with a numeric suffix. Never touches an
    already-set `key` — this is catalog/service.py::_normalize_keyed_items's
    auto-derive path, applied once to existing rows so devices/rules
    authored from now on get a stable key instead of `null`.
    """
    used = {item["key"].strip().lower() for item in items if item.get("key")}
    normalized: list[dict[str, Any]] = []
    for i, raw_item in enumerate(items):
        item = dict(raw_item)
        key = item.get("key")
        if not key:
            base = _slugify(item.get("name") or "", f"{fallback_prefix}-{i + 1}")
            candidate = base
            suffix = 1
            while candidate.lower() in used:
                suffix += 1
                candidate = f"{base}-{suffix}"
            item["key"] = candidate
            used.add(candidate.lower())
        normalized.append(item)
    return normalized


def upgrade() -> None:
    """Upgrade schema.

    Data-only backfill, no schema change — metrics/actuators stay plain
    JSONB (catalog/schemas.py's CatalogMetric.key / CatalogActuator.key stay
    nullable by design, see catalog/service.py). Existing entries authored
    before `key` was wired up as the real wire identifier get one derived
    from their `name` now, so anything created against them going forward
    (rules, firmware sketches, dashboards) gets a stable id instead of null.
    This does NOT retroactively fix any device already publishing to a
    name-based topic — see the accompanying PR description for the required
    manual follow-up on already-deployed firmware.
    """
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, metrics, actuators FROM device_catalog_entries")).fetchall()

    for entry_id, metrics, actuators in rows:
        normalized_metrics = _normalize(metrics, "metric")
        normalized_actuators = _normalize(actuators, "actuator")
        if normalized_metrics == metrics and normalized_actuators == actuators:
            continue
        conn.execute(
            text(
                "UPDATE device_catalog_entries "
                "SET metrics = CAST(:metrics AS jsonb), actuators = CAST(:actuators AS jsonb) "
                "WHERE id = :id"
            ),
            {
                "metrics": json.dumps(normalized_metrics),
                "actuators": json.dumps(normalized_actuators),
                "id": entry_id,
            },
        )


def downgrade() -> None:
    """Downgrade schema.

    No-op — this is a purely additive backfill (fills null keys only, never
    overwrites an existing one) with no prior state worth restoring.
    """
