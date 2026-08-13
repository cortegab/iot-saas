"use client";

import { useMemo } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import { ValueCardWidget } from "@/components/dashboards/ValueCardWidget";
import { TrendChartWidget } from "@/components/dashboards/TrendChartWidget";
import { DeviceStatusWidget } from "@/components/dashboards/DeviceStatusWidget";
import { ActuatorControlWidget } from "@/components/dashboards/ActuatorControlWidget";
import { GaugeWidget } from "@/components/dashboards/GaugeWidget";
import type { components } from "@/types/api";

type Widget = components["schemas"]["Widget"];

const ResponsiveGridLayout = WidthProvider(Responsive);

// v1 simplification: a single breakpoint ("lg", active at any width via
// breakpoints.lg = 0) rather than separately-curated per-breakpoint
// arrangements. Widgets still reflow via WidthProvider's own measurement.
const BREAKPOINTS = { lg: 0 };
const COLS = { lg: 12 };

export function DashboardGrid({
  widgets,
  isAdmin,
  onLayoutChange,
  onRemoveWidget,
}: {
  widgets: Widget[];
  /** Viewer roles get a read-only grid — no remove affordance on any widget.
   * Layout drag/resize stays available to every role; only removal (a
   * destructive, persisted action) is gated, mirroring the rest of the
   * Dashboards module. */
  isAdmin: boolean;
  onLayoutChange: (updated: Widget[]) => void;
  onRemoveWidget: (id: string) => void;
}) {
  const layout = useMemo<Layout>(
    () => widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h })),
    [widgets],
  );

  function handleStop(newLayout: Layout) {
    const updated = widgets.map((widget) => {
      const pos = newLayout.find((item) => item.i === widget.id);
      return pos ? { ...widget, x: pos.x, y: pos.y, w: pos.w, h: pos.h } : widget;
    });
    onLayoutChange(updated);
  }

  return (
    <ResponsiveGridLayout
      layouts={{ lg: layout }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={70}
      margin={[12, 12]}
      draggableHandle=".widget-drag-handle"
      onDragStop={handleStop}
      onResizeStop={handleStop}
    >
      {widgets.map((widget) => {
        const onRemove = isAdmin ? () => onRemoveWidget(widget.id) : undefined;
        return (
          <div key={widget.id}>
            {widget.type === "value_card" && (
              <ValueCardWidget deviceId={widget.device_id} metric={widget.metric ?? null} onRemove={onRemove} />
            )}
            {widget.type === "trend_chart" && (
              <TrendChartWidget deviceId={widget.device_id} metric={widget.metric ?? null} onRemove={onRemove} />
            )}
            {widget.type === "device_status" && (
              <DeviceStatusWidget deviceId={widget.device_id} onRemove={onRemove} />
            )}
            {widget.type === "actuator_control" && (
              <ActuatorControlWidget deviceId={widget.device_id} onRemove={onRemove} />
            )}
            {widget.type === "gauge" && (
              <GaugeWidget
                deviceId={widget.device_id}
                metric={widget.metric ?? null}
                min={widget.min ?? null}
                max={widget.max ?? null}
                onRemove={onRemove}
              />
            )}
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
}
