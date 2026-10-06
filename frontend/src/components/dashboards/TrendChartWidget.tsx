"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { TrendChart } from "@/components/chart/TrendChart";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { DeviceLink, useWidgetDevice } from "@/components/dashboards/widget-common";

export function TrendChartWidget({ deviceId, metric }: { deviceId: string; metric: string | null }) {
  const { device, meta } = useWidgetDevice(deviceId, metric);
  return (
    <WidgetCard title={meta?.name ?? metric ?? "Trend"} subtitle={<DeviceLink device={device} />}>
      {metric ? <TrendChart deviceId={deviceId} metric={metric} meta={meta} fillHeight /> : <EmptyState title="No metric configured" />}
    </WidgetCard>
  );
}
