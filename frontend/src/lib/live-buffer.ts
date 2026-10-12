/**
 * Coalesces live telemetry frames outside React (docs/plans/web-realtime.md).
 *
 * A device publishing 20×/s used to cost 20 SWR mutates per second per key,
 * each re-rendering every subscriber (the whole device page subscribes to
 * `/devices/{id}` and `/latest`) and re-deriving every chart's series. Here
 * frames only land in plain maps; one flush every `intervalMs` hands the
 * caller the newest reading per (device, metric) — for the SWR caches — and
 * hands each chart subscriber every point since the last flush, so charts
 * lose nothing.
 *
 * While the page is hidden, frames are dropped rather than queued: nobody is
 * looking, and useRealtime revalidates the device keys when it's visible
 * again (the same catch-up a WS reconnect does).
 */

export interface LivePoint {
  /** Epoch seconds, as the WS frame carries it. */
  t: number;
  v: number;
}

export interface LatestReading {
  metric: string;
  value: number;
  t: number;
}

/** Newest reading per metric, per device, since the last flush. */
export type LatestBatch = Map<string, LatestReading[]>;

type SeriesListener = (points: LivePoint[]) => void;

const seriesKey = (deviceId: string, metric: string) => `${deviceId}\u0000${metric}`;

export class LiveBuffer {
  private latest = new Map<string, Map<string, LatestReading>>();
  private series = new Map<string, LivePoint[]>();
  private listeners = new Map<string, Set<SeriesListener>>();
  private scheduled = false;
  private onLatest: ((batch: LatestBatch) => void) | null = null;

  constructor(
    private readonly options: {
      intervalMs: number;
      /** Runs `flush` once, `intervalMs` from now (and on a frame, in the browser). */
      schedule: (flush: () => void, delayMs: number) => void;
      isHidden: () => boolean;
    },
  ) {}

  /** The SWR side: one call per flush with every device that had readings. */
  setLatestHandler(handler: ((batch: LatestBatch) => void) | null): void {
    this.onLatest = handler;
  }

  push(deviceId: string, metric: string, value: number, t: number): void {
    if (this.options.isHidden()) return;

    let perDevice = this.latest.get(deviceId);
    if (!perDevice) this.latest.set(deviceId, (perDevice = new Map()));
    const current = perDevice.get(metric);
    if (!current || t >= current.t) perDevice.set(metric, { metric, value, t });

    // Points are only kept for a series somebody is drawing.
    const key = seriesKey(deviceId, metric);
    if (this.listeners.has(key)) {
      let points = this.series.get(key);
      if (!points) this.series.set(key, (points = []));
      points.push({ t, v: value });
    }

    if (!this.scheduled) {
      this.scheduled = true;
      this.options.schedule(() => this.flush(), this.options.intervalMs);
    }
  }

  subscribeSeries(deviceId: string, metric: string, listener: SeriesListener): () => void {
    const key = seriesKey(deviceId, metric);
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(key);
        this.series.delete(key);
      }
    };
  }

  /** Drops everything pending — the page went hidden. */
  clear(): void {
    this.latest.clear();
    this.series.clear();
  }

  flush(): void {
    this.scheduled = false;
    if (this.options.isHidden()) {
      this.clear();
      return;
    }

    const latest = this.latest;
    const series = this.series;
    this.latest = new Map();
    this.series = new Map();

    if (latest.size > 0 && this.onLatest) {
      const batch: LatestBatch = new Map();
      for (const [deviceId, perMetric] of latest) batch.set(deviceId, [...perMetric.values()]);
      try {
        this.onLatest(batch);
      } catch {
        // A failing cache update never stops the charts below.
      }
    }

    for (const [key, points] of series) {
      for (const listener of this.listeners.get(key) ?? []) {
        try {
          listener(points);
        } catch {
          // One misbehaving chart never stops the others.
        }
      }
    }
  }
}

const isBrowser = typeof window !== "undefined";

/** The app's one buffer — fed by useRealtime, read by useRealtime (SWR) and
 * TrendChart (series). Flushes at most 4×/s, and draws on an animation frame. */
export const liveBuffer = new LiveBuffer({
  intervalMs: 250,
  schedule: (flush, delayMs) => {
    setTimeout(() => (isBrowser ? window.requestAnimationFrame(flush) : flush()), delayMs);
  },
  isHidden: () => isBrowser && document.hidden,
});

/** A chart's drawn series, as uPlot columns, tagged with the (device,
 * metric) it belongs to — one chart can switch metric without remounting
 * (DeviceTrendChart), and its points must never carry over. */
export interface Series {
  id: string;
  xs: number[];
  ys: number[];
}

/** A fresh fetch for series `id`: the fetched columns, plus any live points
 * newer than the fetch's tip (the DB lags by its batch flush) — but only
 * live points of this same series; another metric's are dropped. */
export function reseed(prev: Series, id: string, xs: number[], ys: number[]): Series {
  if (prev.id !== id) return { id, xs, ys };
  const tip = xs.length > 0 ? xs[xs.length - 1] : -Infinity;
  for (let i = 0; i < prev.xs.length; i++) {
    if (prev.xs[i] > tip) {
      xs.push(prev.xs[i]);
      ys.push(prev.ys[i]);
    }
  }
  return { id, xs, ys };
}

/** Appends `points` (in arrival order) to aligned `xs`/`ys` in place —
 * skipping any not newer than the current tip, so a reading already in the
 * fetched series isn't drawn twice — then drops what slid out of the window
 * (`cutoff`, epoch seconds). */
export function appendToWindow(xs: number[], ys: number[], points: LivePoint[], cutoff: number): void {
  for (const p of points) {
    if (xs.length > 0 && p.t <= xs[xs.length - 1]) continue;
    xs.push(p.t);
    ys.push(p.v);
  }
  // First index inside the window (xs is ascending).
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    xs.splice(0, lo);
    ys.splice(0, lo);
  }
}
