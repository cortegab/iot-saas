"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { TrendChart } from "@/components/chart/TrendChart";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export function TrendChartWidget({
  deviceId,
  metric,
  onRemove,
}: {
  deviceId: string;
  metric: string | null;
  onRemove: () => void;
}) {
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);

  return (
    <WidgetCard title={device?.name ?? "Trend"} onRemove={onRemove}>
      {metric ? (
        <TrendChart deviceId={deviceId} metric={metric} fillHeight />
      ) : (
        <EmptyState title="No metric configured" />
      )}
    </WidgetCard>
  );
}
