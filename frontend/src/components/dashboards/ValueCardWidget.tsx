"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

export function ValueCardWidget({
  deviceId,
  metric,
  onRemove,
}: {
  deviceId: string;
  metric: string | null;
  onRemove: () => void;
}) {
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  // A fallback, not the primary freshness mechanism — useRealtime revalidates
  // this same key the moment a telemetry message for this device arrives.
  const { data: latest, isLoading } = useApiSWR<TelemetryLatestResponse[]>(
    `/devices/${deviceId}/latest`,
    { refreshInterval: 20_000 },
  );

  const reading = latest?.find((r) => r.metric === metric);

  return (
    <WidgetCard title={device?.name ?? "Value"} onRemove={onRemove}>
      <div className="flex h-full flex-col justify-between">
        {isLoading ? (
          <LoadingSkeleton rows={1} rowClassName="h-10" />
        ) : !metric || !reading ? (
          <EmptyState title="No reading yet" description={metric ? undefined : "No metric configured."} />
        ) : (
          <>
            <span className="text-xs uppercase tracking-wide text-ink-muted">{metric}</span>
            <span className="text-2xl font-semibold text-ink">{reading.value}</span>
          </>
        )}
        {device && (
          <div className="mt-2">
            <ConnectionBadge state={device.connection_state} />
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
