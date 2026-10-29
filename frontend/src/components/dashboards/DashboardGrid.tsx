"use client";

import { useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import { AlertTriangle, GripVertical, Plus } from "lucide-react";
import { ValueCardWidget } from "@/components/dashboards/ValueCardWidget";
import { TrendChartWidget } from "@/components/dashboards/TrendChartWidget";
import { DeviceStatusWidget } from "@/components/dashboards/DeviceStatusWidget";
import { ActuatorControlWidget } from "@/components/dashboards/ActuatorControlWidget";
import { GaugeWidget } from "@/components/dashboards/GaugeWidget";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
const ADD_TILE = "__add-widget";
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
  onOpenWidget,
  onAddWidget,
}: {
  widgets: Widget[];
  /** Edit-layout mode: drag and resize, and a click opens the widget's
   * sheet (DESIGN.md §8). Viewing never moves anything by accident. */
  editing: boolean;
  devices?: DeviceResponse[];
  templates?: CatalogEntryResponse[];
  onLayoutChange: (updated: Widget[]) => void;
  onOpenWidget: (id: string) => void;
  /** Shows an "Add widget" tile in the first row's free columns. */
  onAddWidget?: () => void;
}) {
  const [breakpoint, setBreakpoint] = useState("lg");
  // The add tile belongs to the desktop grid only. Decided from the window
  // (not the grid's breakpoint, which starts as "lg" on every first render),
  // and the grid remounts when it flips: otherwise a phone's first frame
  // seeds the tile into the stacked layout, whose pinned items then never
  // move up into the gap it leaves.
  const wide = useMediaQuery("(min-width: 640px)");
  const deviceName = (w: Widget) => devices?.find((d) => d.id === w.device_id)?.name;
  // The first row's free columns hold an "Add widget" tile instead of blank
  // space (at least 3 columns, and only where no widget reaches into them).
  const addTile = useMemo(() => {
    if (!onAddWidget || !wide || widgets.length === 0) return null;
    const x = Math.max(...widgets.filter((w) => w.y === 0).map((w) => w.x + w.w), 0);
    const tile = { i: ADD_TILE, x, y: 0, w: Math.min(COLS.lg - x, 4), h: 2, static: true };
    if (tile.w < 3) return null;
    const hits = widgets.some((w) => w.x < tile.x + tile.w && w.x + w.w > tile.x && w.y < tile.h);
    return hits ? null : tile;
  }, [widgets, onAddWidget, wide]);
  const layout = useMemo<Layout>(
    () => [...widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h })), ...(addTile ? [addTile] : [])],
    [widgets, addTile],
  );
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
      key={wide ? "wide" : "narrow"}
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
      {addTile && (
        <div key={ADD_TILE}>
          <button
            type="button"
            onClick={onAddWidget}
            className="flex h-full w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-ink-muted transition-colors duration-150 hover:border-accent hover:text-accent"
          >
            <Plus aria-hidden size={15} />
            Add widget
          </button>
        </div>
      )}
      {widgets.map((widget) => {
        const broken = brokenReason(widget, devices, templates);
        return (
          <div key={widget.id} className={cn("group relative", editing && "rounded-xl outline-dashed outline-1 outline-offset-2 outline-accent/50 [&_.widget-title]:pr-12")}>
            {broken ? (
              <WidgetCard title={WIDGET_LABEL[widget.type]}>
                <p className="flex gap-2.5 rounded-md bg-status-error-surface p-3 text-meta text-ink">
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
              <>
                {/* The whole widget opens its sheet (DESIGN.md §8); only the handle drags. */}
                <button
                  type="button"
                  onClick={() => onOpenWidget(widget.id)}
                  aria-label={`Edit ${WIDGET_LABEL[widget.type]}${deviceName(widget) ? `, ${deviceName(widget)}` : ""}`}
                  className="absolute inset-0 z-[5] cursor-pointer rounded-xl hover:bg-accent/5"
                />
                <span
                  className="widget-drag-handle absolute right-1.5 top-1.5 z-10 grid h-8 w-8 cursor-move place-items-center rounded-md border border-border bg-surface text-ink-muted shadow-card"
                  title="Drag to move"
                >
                  <GripVertical aria-hidden size={14} />
                </span>
              </>
            )}
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
}
