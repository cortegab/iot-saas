"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type TelemetryDataResponse = components["schemas"]["TelemetryDataResponse"];
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

export interface ChartThreshold {
  value: number;
  label: string;
}

/** Reads a CSS custom property's resolved value so canvas drawing (which
 * cannot resolve var(...) itself) stays in sync with the active theme —
 * dark is the default, `.light` on <html> is the full peer theme
 * (globals.css) — without hard-coding either palette here. */
function useThemeColors() {
  const [colors, setColors] = useState({ ink: "", inkMuted: "", border: "", chart: "", threshold: "" });

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
  thresholds = [],
  fillHeight = false,
}: {
  deviceId: string;
  metric: string;
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Anchors "now" for the query key itself; the actual live-refresh cadence
    // is SWR's refreshInterval below, not this timer re-rendering.
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const from = new Date(now - rangeMs).toISOString();
  const queryKey = `/devices/${deviceId}/data?metric=${encodeURIComponent(metric)}&from=${encodeURIComponent(from)}&resolution=${resolution}`;

  // The reconciling backstop — useRealtime appends each live telemetry frame
  // straight onto this key's `points` (revalidate:false), so the tip moves
  // in real time; this periodic refetch just resnaps to the authoritative
  // series (and, on wider ranges, the bucket averages).
  const { data, error, isLoading } = useApiSWR<TelemetryDataResponse>(queryKey, {
    refreshInterval: rangeMs <= 6 * HOUR ? 20_000 : 60_000,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const points = useMemo(() => data?.points ?? [], [data]);
  const chartData = useMemo<uPlot.AlignedData>(
    () => [
      points.map((p) => new Date(p.time).getTime() / 1000),
      points.map((p) => p.value),
    ],
    [points],
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
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
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

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: fillHeight ? containerRef.current.clientHeight || 200 : 260,
      padding: [16, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: colors.inkMuted, grid: { stroke: colors.border, width: 1 }, ticks: { stroke: colors.border } },
        { stroke: colors.inkMuted, grid: { stroke: colors.border, width: 1 }, ticks: { stroke: colors.border } },
      ],
      series: [
        {},
        {
          label: metric,
          stroke: colors.chart,
          width: 2,
          points: { show: chartData[0].length < 200 },
        },
      ],
      hooks: { draw: [drawThresholds] },
    };

    plotRef.current = new uPlot(opts, chartData, containerRef.current);

    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // chartData is intentionally excluded — updated via setData in the effect
    // below so a live tick doesn't tear down/rebuild (and lose zoom/pan state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, metric, thresholds, fillHeight]);

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

  const aggregatedLabel = RESOLUTION_LABEL[resolution];

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
            : `min-w-0 overflow-hidden rounded-xl border border-border border-t-panel-edge bg-surface p-2 ${
                fillHeight ? "min-h-0 flex-1" : ""
              }`
        }
      >
        <div ref={containerRef} className={fillHeight ? "h-full min-h-0" : ""} />
      </div>
    </div>
  );
}
