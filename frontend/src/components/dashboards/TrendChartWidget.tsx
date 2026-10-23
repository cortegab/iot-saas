"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { TrendChart } from "@/components/chart/TrendChart";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { useDashboardRange, useWidgetDevice } from "@/components/dashboards/widget-common";

/** A trend on the dashboard's one range (demo H): no range buttons of its own. */
export function TrendChartWidget({ deviceId, metric }: { deviceId: string; metric: string | null }) {
  const { device, meta } = useWidgetDevice(deviceId, metric);
  const range = useDashboardRange();
  return (
    <WidgetCard title={meta?.name ?? metric ?? "Trend"} device={device}>
      {metric ? <TrendChart deviceId={deviceId} metric={metric} meta={meta} rangeMs={range} fillHeight /> : <EmptyState title="No metric configured" />}
    </WidgetCard>
  );
}
