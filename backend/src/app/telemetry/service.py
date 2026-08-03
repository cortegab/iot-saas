"""Telemetry query service — dashboards read through here, never raw SQL
against the hypertable directly, and (per CLAUDE.md §5) never query raw
telemetry for anything beyond the smallest windows: `resolution` picks the
1-minute or 1-hour continuous aggregate for anything wider.

Unlike every other tenant-scoped table, `telemetry` (and its rollups) has no
Row-Level Security — TimescaleDB compression and RLS can't coexist on the same
hypertable (see the create_telemetry_hypertable migration for the confirmed
limitation and the tradeoff). That makes the explicit `tenant_id` filter on
every query below the *only* tenant isolation this data has — there is no RLS
backstop for a forgotten WHERE clause here the way there is everywhere else.
"""

import uuid
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.telemetry.schemas import TelemetryDataPoint, TelemetryDataResponse, TelemetryLatestResponse

# table/time-column/value-column per resolution. `resolution` is user input,
# but only ever used as a dict *key* here — the strings interpolated into SQL
# below always come from this fixed allowlist, never from the request itself,
# so there is no injection surface despite the f-string.
_RESOLUTION_TABLES: dict[str, tuple[str, str, str]] = {
    "raw": ("telemetry", "time", "value"),
    "1m": ("telemetry_1m", "bucket", "avg_value"),
    "1h": ("telemetry_1h", "bucket", "avg_value"),
}

VALID_RESOLUTIONS = frozenset(_RESOLUTION_TABLES)


class InvalidResolutionError(Exception):
    pass


async def get_latest(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> list[TelemetryLatestResponse]:
    """Most recent reading per metric for this device."""
    result = await session.execute(
        text(
            "SELECT DISTINCT ON (metric) metric, value, time FROM telemetry "
            "WHERE tenant_id = :tenant_id AND device_id = :device_id "
            "ORDER BY metric, time DESC"
        ),
        {"tenant_id": tenant_id, "device_id": device_id},
    )
    return [
        TelemetryLatestResponse(metric=row.metric, value=row.value, time=row.time)
        for row in result
    ]


async def get_range(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    metric: str,
    from_: datetime,
    to: datetime,
    resolution: str,
) -> TelemetryDataResponse:
    if resolution not in _RESOLUTION_TABLES:
        raise InvalidResolutionError(resolution)
    table, time_col, value_col = _RESOLUTION_TABLES[resolution]

    result = await session.execute(
        text(
            f"SELECT {time_col} AS time, {value_col} AS value FROM {table} "
            "WHERE tenant_id = :tenant_id AND device_id = :device_id AND metric = :metric "
            f"AND {time_col} BETWEEN :from_ AND :to "
            f"ORDER BY {time_col}"
        ),
        {"tenant_id": tenant_id, "device_id": device_id, "metric": metric, "from_": from_, "to": to},
    )
    points = [TelemetryDataPoint(time=row.time, value=row.value) for row in result]
    return TelemetryDataResponse(metric=metric, resolution=resolution, points=points)
