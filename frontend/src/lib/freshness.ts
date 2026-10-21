import type { Freshness } from "@/components/ui/Readout";
import type { components } from "@/types/api";

type CatalogMetric = components["schemas"]["CatalogMetric"];

const DAY_MS = 24 * 3600 * 1000;

/** How long a reading stays live: three publish intervals for a periodic
 * metric (30 s when unset), 30 s for streaming, a day for on-change ones,
 * which may rightly stay quiet for hours (demo H `freshness()`). */
export function liveWindowMs(metric: Pick<CatalogMetric, "publish" | "publish_interval_seconds"> | undefined): number {
  if (!metric || metric.publish === "periodic") return (metric?.publish_interval_seconds ?? 30) * 3 * 1000;
  if (metric.publish === "streaming") return 30 * 1000;
  return DAY_MS;
}

/** A reading's freshness badge (DESIGN.md §8 device Overview): **No data**
 * when nothing was ever received, **Live** while the device is online and the
 * reading is inside its live window, otherwise **Stale**. */
export function readingFreshness(
  online: boolean,
  metric: Pick<CatalogMetric, "publish" | "publish_interval_seconds"> | undefined,
  time: string | null | undefined,
  now: number = Date.now(),
): Freshness {
  if (!time) return "none";
  return online && now - new Date(time).getTime() < liveWindowMs(metric) ? "live" : "stale";
}
