"use client";

import { useEffect, useState } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { TrendChart, type ChartThreshold } from "@/components/chart/TrendChart";
import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

/**
 * Only offers metrics this device has actually reported (UX_UI_Description.md
 * §3: never a chart shell for a metric that's never arrived). Reuses the same
 * SWR key CurrentReadings fetches on the device page — same cache entry, no
 * extra request.
 */
export function DeviceTrendChart({
  deviceId,
  thresholdsByMetric = {},
}: {
  deviceId: string;
  thresholdsByMetric?: Record<string, ChartThreshold[]>;
}) {
  const { data, isLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && data && data.length > 0) setSelected(data[0].metric);
  }, [data, selected]);

  if (isLoading) return <LoadingSkeleton rows={1} rowClassName="h-[300px]" />;

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No readings yet"
        description="Once this device publishes telemetry, its trend chart appears here."
      />
    );
  }

  const activeMetric = selected ?? data[0].metric;

  return (
    <div className="flex flex-col gap-3">
      {data.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Metric">
          {data.map((m) => (
            <button
              key={m.metric}
              type="button"
              aria-pressed={activeMetric === m.metric}
              onClick={() => setSelected(m.metric)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs font-medium transition-colors duration-150 ${
                activeMetric === m.metric
                  ? "border-accent bg-accent text-on-accent"
                  : "border-border text-ink-muted hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {m.metric}
            </button>
          ))}
        </div>
      )}
      <TrendChart deviceId={deviceId} metric={activeMetric} thresholds={thresholdsByMetric[activeMetric]} />
    </div>
  );
}
