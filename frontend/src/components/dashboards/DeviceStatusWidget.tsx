"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export function DeviceStatusWidget({ deviceId, onRemove }: { deviceId: string; onRemove: () => void }) {
  // A fallback, not the primary freshness mechanism — useRealtime revalidates
  // this same key the moment a telemetry message implies the device is online.
  const { data: device, isLoading } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`, {
    refreshInterval: 20_000,
  });

  return (
    <WidgetCard title={device?.name ?? "Device status"} onRemove={onRemove}>
      {isLoading || !device ? (
        <LoadingSkeleton rows={1} rowClassName="h-8" />
      ) : (
        <div className="flex h-full flex-col justify-center gap-2">
          <span className="text-sm text-ink">{device.name}</span>
          <ConnectionBadge state={device.connection_state} />
        </div>
      )}
    </WidgetCard>
  );
}
