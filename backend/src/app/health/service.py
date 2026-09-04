"""Per-metric device health: the batched storage-path write, the API read,
and the catalog-publish-profile -> staleness-bound derivation that feeds
app.rules.service's hot-path cache (app.worker's health_monitor_loop).

Every function takes tenant_id explicitly where the caller has one — RLS
enforces the tenant boundary (CLAUDE.md §7). `compute_staleness_thresholds`
is the one exception: like app.rules.service.load_rule_cache, it runs in the
worker with no single tenant context, so it reads through a SECURITY
DEFINER function spanning every tenant at once.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.health.models import DeviceMetricHealth
from app.rules.evaluators import SignalKey
from app.rules.service import DEFAULT_STALE_METRIC_AGE_SECONDS

log = logging.getLogger("health")

# publish="periodic"/"streaming": a metric is considered stale once it's gone
# this many multiples of its own interval without a new reading — generous
# enough to absorb normal jitter without false-flagging, tight enough to
# still mean something.
_STALENESS_INTERVAL_MULTIPLIER = 3

# publish="on_change" has no fixed cadence — "no update in 2 hours" is
# expected behavior for a door sensor, not staleness. Open product question
# (see rule-engine-redesign-plan): ideally this falls back to the device's
# own Tier A liveness (devices.last_status_online) instead of a numeric
# bound. Until that's wired into the evaluator snapshot, use a generous fixed
# ceiling so an on_change metric isn't spuriously flagged stale by the
# periodic/streaming-tuned default.
_ON_CHANGE_MAX_AGE_SECONDS = 24 * 60 * 60


async def list_for_device(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> list[DeviceMetricHealth]:
    result = await session.execute(
        select(DeviceMetricHealth).where(
            DeviceMetricHealth.tenant_id == tenant_id, DeviceMetricHealth.device_id == device_id
        )
    )
    return list(result.scalars().all())


async def record_batch(
    session: AsyncSession,
    rows: Sequence[tuple[uuid.UUID, str, float]],
    seen_at: datetime,
) -> None:
    """Batched Tier B upsert — called once per storage-path flush
    (app.worker's stream_writer_loop), in the same transaction as
    devices_service.touch_last_seen, never per-message. `rows` is
    (device_id, metric, value), already deduplicated to the latest value per
    (device_id, metric) within this flush by the caller. One shared
    `seen_at` for the whole batch, same reasoning touch_last_seen already
    uses: this only has to be accurate to "the writer flushed recently," not
    per-reading precision. Backed by the upsert_device_metric_health
    SECURITY DEFINER function — the worker's session has no single tenant
    context, so a plain upsert against RLS-protected device_metric_health
    would touch zero rows.
    """
    if not rows:
        return
    device_ids = [str(device_id) for device_id, _, _ in rows]
    metrics = [metric for _, metric, _ in rows]
    values = [value for _, _, value in rows]
    await session.execute(
        text("SELECT upsert_device_metric_health(:device_ids, :metrics, :values, :seen_at)"),
        {"device_ids": device_ids, "metrics": metrics, "values": values, "seen_at": seen_at},
    )


def _derive_max_age(publish: str, publish_interval_seconds: int | None) -> int:
    if publish == "on_change":
        return _ON_CHANGE_MAX_AGE_SECONDS
    if publish_interval_seconds:
        return publish_interval_seconds * _STALENESS_INTERVAL_MULTIPLIER
    return DEFAULT_STALE_METRIC_AGE_SECONDS


async def compute_staleness_thresholds(
    factory: async_sessionmaker[AsyncSession],
) -> dict[SignalKey, int]:
    """Every active device's per-metric expected max-age, derived from its
    catalog entry's publish profile — called at worker startup and on every
    catalog:invalidate message (app.worker's health_monitor_loop), which
    hands the result straight to app.rules.service.reload_staleness_thresholds.
    Full reload, not incremental — simple and correct at 500-1000 device
    scale, same call as load_rule_cache makes for the same reason.
    """
    async with factory() as session:
        result = await session.execute(text("SELECT * FROM list_active_metric_publish_profiles()"))
        rows = result.mappings().all()

    thresholds: dict[SignalKey, int] = {}
    for row in rows:
        if not row["metric"]:
            continue
        thresholds[SignalKey(str(row["device_id"]), row["metric"])] = _derive_max_age(
            row["publish"], row["publish_interval_seconds"]
        )
    log.info("staleness thresholds computed for %d signals", len(thresholds))
    return thresholds
