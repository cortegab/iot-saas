"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Readout } from "@/components/ui/Readout";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { DeviceLink, useWidgetDevice, WidgetFoot } from "@/components/dashboards/widget-common";
import { formatReading, isBoolMetric } from "@/lib/format-reading";
import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

export function ValueCardWidget({ deviceId, metric }: { deviceId: string; metric: string | null }) {
  const { device, meta, stale } = useWidgetDevice(deviceId, metric);
  // A fallback, not the primary freshness mechanism — useRealtime applies
  // telemetry frames to this same key the moment they arrive.
  const { data: latest, isLoading } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 20_000 });
  const reading = latest?.find((r) => r.metric === metric);
  const isBool = isBoolMetric(meta);
  const value = reading ? formatReading(reading.value, meta) : "—";

  return (
    <WidgetCard title={meta?.name ?? metric ?? "Value"} subtitle={<DeviceLink device={device} />}>
      <div className="flex h-full flex-col justify-between gap-1">
        {isLoading ? (
          <LoadingSkeleton rows={1} rowClassName="h-10" />
        ) : (
          <Readout value={value} unit={reading && !isBool ? (meta?.unit ?? undefined) : undefined} size="lg" stale={stale && !!reading} framed={false} />
        )}
        {reading ? <WidgetFoot stale={stale} time={reading.time} /> : <span className="text-[11.5px] text-ink-muted">No data yet</span>}
      </div>
    </WidgetCard>
  );
}
