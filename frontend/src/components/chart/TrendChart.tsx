"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import useSWR from "swr";
import { useApi } from "@/hooks/useApi";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { boolBuckets } from "@/lib/bool-series";
import { formatReading, isBoolMetric } from "@/lib/format-reading";
import type { components } from "@/types/api";

type TelemetryDataResponse = components["schemas"]["TelemetryDataResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type Resolution = "raw" | "1m" | "1h";

const HOUR = 60 * 60 * 1000;
const RANGE_OPTIONS: { label: string; ms: number }[] = [
  { label: "10m", ms: 10 * 60 * 1000 },
  { label: "1h", ms: HOUR },
  { label: "6h", ms: 6 * HOUR },
  { label: "24h", ms: 24 * HOUR },
  { label: "7d", ms: 7 * 24 * HOUR },
];

// Every preset here ends at "now", so every fetch is inherently a live-window
// fetch — polling is always appropriate. A fixed-in-the-past custom range
// (not built in this pass) would need refreshInterval disabled instead
// (UX_UI_Description.md §4: don't re-fetch a historical range that can't change).
function resolutionFor(rangeMs: number): Resolution {
  if (rangeMs <= HOUR) return "raw";
  if (rangeMs <= 24 * HOUR) return "1m";
  return "1h";
}

const RESOLUTION_LABEL: Record<Resolution, string | null> = {
  raw: null,
  "1m": "1-minute average",
  "1h": "1-hour average",
};

// An on/off metric's rollup average is the share of its *readings* that were
// On — not of the time (a pulse publishes an On and an Off together, which
// averages to 50% though it was Off almost all minute). What the rollup can
// say honestly is whether it was On at any point in the bucket (avg > 0), so
// aggregated ranges keep the same Off/On axis as raw ones (lib/bool-series).
const BOOL_RESOLUTION_LABEL: Record<Resolution, string | null> = {
  raw: null,
  "1m": "On if it was On at any point in the minute",
  "1h": "On if it was On at any point in the hour",
};

// On/off metrics hold their state until the next reading, so they're drawn
// as steps, never as ramps between readings.
const stepped = uPlot.paths.stepped?.({ align: 1 });

export interface ChartThreshold {
  value: number;
  label: string;
}

/** Reads a CSS custom property's resolved value so canvas drawing (which
 * cannot resolve var(...) itself) stays in sync with the active theme —
 * light is the default, `.dark` on <html> is the full peer theme
 * (globals.css) — without hard-coding either palette here. */
function useThemeColors() {
  const [colors, setColors] = useState({
    ink: "",
    inkMuted: "",
    border: "",
    chart: "",
    threshold: "",
    mono: "",
  });

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setColors({
        ink: style.getPropertyValue("--color-ink").trim(),
        inkMuted: style.getPropertyValue("--color-ink-muted").trim(),
        border: style.getPropertyValue("--color-border").trim(),
        // The series is the instrument colour; the threshold marker is the alert
        // colour, so a breached level stays legible against the trace.
        chart: style.getPropertyValue("--color-chart").trim(),
        threshold: style.getPropertyValue("--color-status-offline").trim(),
        // next/font's generated family list for Geist Mono.
        mono: style.getPropertyValue("--ff-mono").trim(),
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export function TrendChart({
  deviceId,
  metric,
  meta,
  thresholds = [],
  fillHeight = false,
}: {
  deviceId: string;
  metric: string;
  /** The metric's template entry: its name labels the series, and its type,
   * decimals and unit format the axis and legend. An on/off metric is drawn
   * as steps on an Off/On axis at every range, with no rule line —
   * the axis already says what the rule compares against. */
  meta?: CatalogMetric;
  thresholds?: ChartThreshold[];
  /** Default: a fixed 260px, matching every existing usage. When true, the
   * container fills its parent's height instead (dashboard widgets, where a
   * react-grid-layout cell already provides a real pixel height ancestor)
   * and the chart resizes with it via the ResizeObserver below. */
  fillHeight?: boolean;
}) {
  const [rangeMs, setRangeMs] = useState(RANGE_OPTIONS[0].ms);
  const resolution = resolutionFor(rangeMs);
  const colors = useThemeColors();
  const isBool = isBoolMetric(meta);
  // Aggregated on/off data: On if any reading in the bucket was On.
  const anyOn = isBool && resolution !== "raw";

  // A stable cache key per (device, metric, window) — not a URL. `from` is
  // computed at fetch time instead of being baked into the key: a key that
  // re-anchored to "now" every few seconds minted a fresh cache entry each
  // time, froze the chart on the previous snapshot while it loaded, and left
  // useRealtime guessing which of the lingering keys was on screen (it guessed
  // wrong on every range but 10m). useRealtime matches this exact shape — the
  // `metric=…&window=…` prefix — to append live frames, so keep them in sync.
  const encodedMetric = encodeURIComponent(metric);
  const queryKey = `/devices/${deviceId}/data?metric=${encodedMetric}&window=${rangeMs}&resolution=${resolution}`;

  // The reconciling backstop — useRealtime appends each live telemetry frame
  // straight onto this key's `points` (revalidate:false), so the tip moves
  // in real time; this periodic refetch just resnaps to the authoritative
  // series (and, on wider ranges, the bucket averages).
  //
  // keepPreviousData: switching range or metric changes the key — without this
  // the chart would blank to a loading skeleton while the new key's first fetch runs.
  const api = useApi();
  const { data, error, isLoading } = useSWR<TelemetryDataResponse>(
    queryKey,
    () => {
      const from = new Date(Date.now() - rangeMs).toISOString();
      return api.get<TelemetryDataResponse>(
        `/devices/${deviceId}/data?metric=${encodedMetric}&from=${encodeURIComponent(from)}&resolution=${resolution}`,
      );
    },
    {
      refreshInterval: rangeMs <= 6 * HOUR ? 20_000 : 60_000,
      keepPreviousData: true,
    },
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const points = useMemo(() => data?.points ?? [], [data]);
  const chartData = useMemo<uPlot.AlignedData>(
    () =>
      anyOn
        ? boolBuckets(points, resolution === "1h" ? 3600 : 60)
        : [points.map((p) => new Date(p.time).getTime() / 1000), points.map((p) => p.value)],
    [points, anyOn, resolution],
  );

  // Rebuild (not just re-set-data) whenever the theme or threshold set changes,
  // since axis/grid colors and the threshold-line draw hook are baked into the
  // uPlot options at construction time.
  useEffect(() => {
    if (!containerRef.current || !colors.ink) return;
    plotRef.current?.destroy();

    const drawThresholds: uPlot.Hooks.Defs["draw"] = (u) => {
      const { ctx } = u;
      ctx.save();
      ctx.font = `11px ${colors.mono ? `${colors.mono}, ` : ""}ui-monospace, monospace`;
      for (const t of thresholds) {
        const y = u.valToPos(t.value, "y", true);
        if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue;
        ctx.strokeStyle = colors.threshold;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, y);
        ctx.lineTo(u.bbox.left + u.bbox.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.threshold;
        ctx.textAlign = "right";
        ctx.fillText(t.label, u.bbox.left + u.bbox.width - 4, y - 4);
      }
      ctx.restore();
    };

    const axis = { stroke: colors.inkMuted, grid: { stroke: colors.border, width: 1 }, ticks: { stroke: colors.border } };
    const unit = meta?.unit ? ` ${meta.unit}` : "";
    const legendValue = (_u: uPlot, v: number | null) =>
      v == null ? "--" : `${formatReading(v, meta)}${isBool ? "" : unit}`;

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: fillHeight ? containerRef.current.clientHeight || 200 : 260,
      padding: [16, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: true },
        ...(isBool && { y: { range: [-0.1, 1.1] } }),
      },
      axes: [
        axis,
        isBool ? { ...axis, splits: () => [0, 1], values: (_u, vs) => vs.map((v) => (v ? "On" : "Off")) } : axis,
      ],
      series: [
        {},
        {
          label: meta?.name ?? metric,
          stroke: colors.chart,
          width: 2,
          value: legendValue,
          ...(isBool && {
            paths: stepped,
            fillTo: 0,
            // A light wash under the On periods, so they read at a glance.
            // (--color-chart is a #rrggbb token; canvas can't resolve color-mix.)
            fill: /^#[0-9a-f]{6}$/i.test(colors.chart) ? `${colors.chart}24` : undefined,
          }),
          // Markers are the readings; aggregated on/off steps are bucket spans, not readings.
          points: { show: !anyOn && points.length < 200 },
        },
      ],
      hooks: { draw: isBool ? [] : [drawThresholds] },
    };

    plotRef.current = new uPlot(opts, chartData, containerRef.current);

    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // chartData is intentionally excluded — updated via setData in the effect
    // below so a live tick doesn't tear down/rebuild (and lose zoom/pan state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, metric, meta, anyOn, thresholds, fillHeight]);

  useEffect(() => {
    plotRef.current?.setData(chartData);
  }, [chartData]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (plotRef.current && containerRef.current) {
        plotRef.current.setSize({
          width: containerRef.current.clientWidth,
          height: fillHeight ? containerRef.current.clientHeight : 260,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fillHeight]);

  const aggregatedLabel = (isBool ? BOOL_RESOLUTION_LABEL : RESOLUTION_LABEL)[resolution];

  return (
    <div className={`flex flex-col gap-2 ${fillHeight ? "h-full min-h-0" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex gap-1" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={rangeMs === opt.ms}
              onClick={() => setRangeMs(opt.ms)}
              className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors duration-150 ${
                rangeMs === opt.ms
                  ? "bg-surface-raised text-ink"
                  : "text-ink-muted hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {aggregatedLabel && (
          <span className="text-xs text-ink-muted" title="This range is too wide to show every raw reading">
            Aggregated — {aggregatedLabel}
          </span>
        )}
      </div>

      {isLoading && <LoadingSkeleton rows={1} rowClassName="h-[260px]" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load chart data."}
        />
      )}

      {!isLoading && !error && points.length === 0 && (
        <EmptyState
          title="No data in this range"
          description="Try a wider time range, or check back once this device reports again."
        />
      )}

      {/* The measured element is the *inner* unpadded div, not this padded
          wrapper: sizing uPlot to a padded box's clientWidth makes its canvas
          wider than the space it sits in, and flex items' default
          min-width:auto lets that overshoot ratchet the layout wider on every
          ResizeObserver tick — the "chart keeps growing horizontally" bug.
          overflow-hidden + min-w-0 stop any residual off-by-one from doing the
          same. */}
      <div
        className={
          points.length === 0
            ? "hidden"
            : `min-w-0 overflow-hidden rounded-xl border border-border shadow-card bg-surface p-2 ${
                fillHeight ? "min-h-0 flex-1" : ""
              }`
        }
      >
        <div ref={containerRef} className={fillHeight ? "h-full min-h-0" : ""} />
      </div>
    </div>
  );
}
