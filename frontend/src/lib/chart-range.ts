/** The trend chart's time ranges and its live, pinned x window
 * (docs/design/DESIGN.md §5 "Trend chart"). */

export const HOUR = 60 * 60 * 1000;

export const RANGE_OPTIONS: { label: string; ms: number }[] = [
  { label: "1m", ms: 60 * 1000 },
  { label: "10m", ms: 10 * 60 * 1000 },
  { label: "1h", ms: HOUR },
  { label: "6h", ms: 6 * HOUR },
  { label: "24h", ms: 24 * HOUR },
  { label: "7d", ms: 7 * 24 * HOUR },
];

/** Charts open on 10m: 1m is often empty for a slow or on_change sensor. */
export const DEFAULT_RANGE_MS = RANGE_OPTIONS.find((o) => o.label === "10m")!.ms;

/** How often the pinned x axis slides forward: ~120 steps per window, so 1m
 * moves every second and 7d once a minute. */
export function slideIntervalMs(rangeMs: number): number {
  return Math.min(60_000, Math.max(1_000, Math.round(rangeMs / 120)));
}

/** The x window in uPlot seconds: the whole range, ending at `nowMs`. */
export function pinnedWindow(rangeMs: number, nowMs: number = Date.now()): [number, number] {
  const now = nowMs / 1000;
  return [now - rangeMs / 1000, now];
}
