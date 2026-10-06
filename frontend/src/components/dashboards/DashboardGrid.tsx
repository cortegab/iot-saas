"use client";

import { useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import { AlertTriangle, GripVertical, X } from "lucide-react";
import { ValueCardWidget } from "@/components/dashboards/ValueCardWidget";
import { TrendChartWidget } from "@/components/dashboards/TrendChartWidget";
import { DeviceStatusWidget } from "@/components/dashboards/DeviceStatusWidget";
import { ActuatorControlWidget } from "@/components/dashboards/ActuatorControlWidget";
import { GaugeWidget } from "@/components/dashboards/GaugeWidget";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { cn } from "@/lib/cn";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type Widget = components["schemas"]["Widget"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const ResponsiveGridLayout = WidthProvider(Responsive);

// The saved layout is the 12-column one ("lg"). Below 640px the widgets
// stack in one column in reading order ("sm", derived, never saved), so a
// phone neither squeezes twelve columns nor rewrites the desktop layout.
const BREAKPOINTS = { lg: 640, sm: 0 };
const COLS = { lg: 12, sm: 1 };
/** Width steps the width button cycles through (demo G). */
export const WIDTHS = [3, 4, 6, 8, 12] as const;

export const WIDGET_LABEL: Record<Widget["type"], string> = {
  value_card: "Value card",
  trend_chart: "Trend chart",
  gauge: "Gauge",
  device_status: "Device status",
  actuator_control: "Actuator control",
};

/** Why a widget can't render, or null. A widget outlives its device and its
 * template's metrics; it says so instead of showing an empty card. */
export function brokenReason(
  w: Widget,
  devices: DeviceResponse[] | undefined,
  templates: CatalogEntryResponse[] | undefined,
): string | null {
  if (!devices || !templates) return null;
  const device = devices.find((d) => d.id === w.device_id);
  if (!device) return "This widget's device was deleted. Remove the widget and add a new one.";
  const tpl = templates.find((t) => t.id === device.catalog_entry_id);
  if (!tpl) return null;
  if ((w.type === "value_card" || w.type === "trend_chart" || w.type === "gauge") && tpl.metrics.length > 0) {
    if (!w.metric || !tpl.metrics.some((m) => wireId(m) === w.metric)) {
      return `${w.metric || "No metric"} isn't published by ${device.name} (${tpl.name}) anymore. Remove this widget and add one with another metric.`;
    }
  }
  return null;
}

export function DashboardGrid({
  widgets,
  editing,
  devices,
  templates,
  onLayoutChange,
  onRemoveWidget,
  onCycleWidth,
}: {
  widgets: Widget[];
  /** Edit-layout mode: drag, resize, width and remove. Viewing never moves
   * anything by accident. */
  editing: boolean;
  devices?: DeviceResponse[];
  templates?: CatalogEntryResponse[];
  onLayoutChange: (updated: Widget[]) => void;
  onRemoveWidget: (id: string) => void;
  onCycleWidth: (id: string) => void;
}) {
  const [breakpoint, setBreakpoint] = useState("lg");
  const layout = useMemo<Layout>(() => widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h })), [widgets]);
  const stacked = useMemo<Layout>(() => {
    let y = 0;
    return [...widgets]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((w) => {
        const item = { i: w.id, x: 0, y, w: 1, h: w.h, static: true };
        y += w.h;
        return item;
      });
  }, [widgets]);

  function handleStop(newLayout: Layout) {
    if (breakpoint !== "lg") return;
    const updated = widgets.map((widget) => {
      const pos = newLayout.find((item) => item.i === widget.id);
      return pos ? { ...widget, x: pos.x, y: pos.y, w: pos.w, h: pos.h } : widget;
    });
    if (updated.some((w, i) => w.x !== widgets[i].x || w.y !== widgets[i].y || w.w !== widgets[i].w || w.h !== widgets[i].h)) {
      onLayoutChange(updated);
    }
  }

  return (
    <ResponsiveGridLayout
      layouts={{ lg: layout, sm: stacked }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={70}
      margin={[12, 12]}
      containerPadding={[0, 0]}
      onBreakpointChange={(bp) => setBreakpoint(bp)}
      isDraggable={editing && breakpoint === "lg"}
      isResizable={editing && breakpoint === "lg"}
      draggableHandle=".widget-drag-handle"
      onDragStop={handleStop}
      onResizeStop={handleStop}
    >
      {widgets.map((widget) => {
        const broken = brokenReason(widget, devices, templates);
        return (
          <div key={widget.id} className={cn("group relative", editing && "rounded-xl outline-dashed outline-1 outline-offset-2 outline-accent/50 [&_.widget-title]:pr-28")}>
            {broken ? (
              <WidgetCard title={WIDGET_LABEL[widget.type]}>
                <p className="flex gap-2.5 rounded-md bg-status-error-surface p-3 text-[13.5px] text-ink">
                  <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0 text-status-error" />
                  {broken}
                </p>
              </WidgetCard>
            ) : widget.type === "value_card" ? (
              <ValueCardWidget deviceId={widget.device_id} metric={widget.metric ?? null} />
            ) : widget.type === "trend_chart" ? (
              <TrendChartWidget deviceId={widget.device_id} metric={widget.metric ?? null} />
            ) : widget.type === "device_status" ? (
              <DeviceStatusWidget deviceId={widget.device_id} />
            ) : widget.type === "actuator_control" ? (
              <ActuatorControlWidget deviceId={widget.device_id} />
            ) : (
              <GaugeWidget deviceId={widget.device_id} metric={widget.metric ?? null} min={widget.min ?? null} max={widget.max ?? null} />
            )}
            {editing && (
              <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-card">
                <span className="widget-drag-handle grid h-7 w-7 cursor-move place-items-center text-ink-muted" title="Drag to move">
                  <GripVertical aria-hidden size={14} />
                </span>
                <button
                  type="button"
                  onClick={() => onCycleWidth(widget.id)}
                  aria-label={`Width ${widget.w} of 12 columns. Change width`}
                  className="h-7 rounded px-1.5 font-mono text-[11.5px] text-ink-muted hover:bg-surface-raised hover:text-ink"
                >
                  {widget.w}/12
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveWidget(widget.id)}
                  aria-label={`Remove ${WIDGET_LABEL[widget.type]}`}
                  className="grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-status-error-surface hover:text-status-error"
                >
                  <X aria-hidden size={13} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
}
