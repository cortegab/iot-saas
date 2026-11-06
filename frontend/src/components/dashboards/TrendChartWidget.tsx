"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { TrendChart } from "@/components/chart/TrendChart";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { useDashboardRange, useWidgetDevice } from "@/components/dashboards/widget-common";

/** A trend on the dashboard's one range (demo H): no range buttons of its own.
 * In the grid it fills its cell; stacked on a phone (`fill={false}`) it takes
 * the chart's own height. */
export function TrendChartWidget({ deviceId, metric, fill = true }: { deviceId: string; metric: string | null; fill?: boolean }) {
  const { device, meta } = useWidgetDevice(deviceId, metric);
  const range = useDashboardRange();
  return (
    <WidgetCard title={meta?.name ?? metric ?? "Trend"} device={device}>
      {metric ? <TrendChart deviceId={deviceId} metric={metric} meta={meta} rangeMs={range} fillHeight={fill} /> : <EmptyState title="No metric configured" />}
    </WidgetCard>
  );
}
