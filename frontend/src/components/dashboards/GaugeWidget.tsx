"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { useWidgetDevice, WidgetFoot } from "@/components/dashboards/widget-common";
import { cn } from "@/lib/cn";
import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

// demo G's semicircular gauge: one arc from left to right through the top,
// the value as a dash along it, min/max under the ends.
const ARC = "M12 62 A48 48 0 0 1 108 62";
const ARC_LENGTH = Math.PI * 48;

export function GaugeWidget({
  deviceId,
  metric,
  min,
  max,
}: {
  deviceId: string;
  metric: string | null;
  min: number | null;
  max: number | null;
}) {
  const { device, meta, stale } = useWidgetDevice(deviceId, metric);
  // A fallback, not the primary freshness mechanism — useRealtime applies
  // telemetry frames to this same key the moment they arrive.
  const { data: latest, isLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 20_000 });
  const reading = latest?.find((r) => r.metric === metric);
  const lo = min ?? meta?.min ?? 0;
  const hi = max ?? meta?.max ?? 100;
  const fraction = reading && hi > lo ? Math.min(1, Math.max(0, (reading.value - lo) / (hi - lo))) : 0;
  const shown = reading ? (meta?.decimals != null ? reading.value.toFixed(meta.decimals) : reading.value.toLocaleString()) : "—";

  return (
    <WidgetCard title={meta?.name ?? metric ?? "Gauge"} device={device}>
      <div className="flex h-full flex-col items-center justify-between gap-1">
        {isLoading ? (
          <LoadingSkeleton rows={1} rowClassName="h-16" />
        ) : (
          <svg viewBox="0 0 120 66" role="img" aria-label={`${shown} ${meta?.unit ?? ""} on a ${lo} to ${hi} scale`} className="w-full max-w-[200px] min-h-0 flex-1">
            <path d={ARC} fill="none" stroke="var(--color-surface-raised)" strokeWidth={10} strokeLinecap="round" />
            {reading && (
              <path
                d={ARC}
                fill="none"
                stroke="var(--color-chart)"
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={`${(fraction * ARC_LENGTH).toFixed(1)} ${ARC_LENGTH.toFixed(1)}`}
              />
            )}
            {/* The unit beside the value (demo H); the scale is the caption below. */}
            <text x="60" y="58" textAnchor="middle" className={cn("fill-ink text-[20px] font-semibold tabular-nums", stale && "opacity-55")}>
              {shown}
              {reading && meta?.unit && <tspan className="fill-ink-muted text-[11px] font-normal">{` ${meta.unit}`}</tspan>}
            </text>
          </svg>
        )}
        {!reading ? (
          <span className="text-[11.5px] text-ink-muted">No data</span>
        ) : stale ? (
          <WidgetFoot stale time={reading.time} />
        ) : (
          <span className="text-[11.5px] tabular-nums text-ink-muted">
            {lo}–{hi}
            {meta?.unit ? ` ${meta.unit}` : ""}
          </span>
        )}
      </div>
    </WidgetCard>
  );
}
