import type { components } from "@/types/api";

type Widget = components["schemas"]["Widget"];

const WIDGET_NAMES: Record<Widget["type"], [string, string]> = {
  value_card: ["value card", "value cards"],
  trend_chart: ["trend chart", "trend charts"],
  gauge: ["gauge", "gauges"],
  device_status: ["status card", "status cards"],
  actuator_control: ["control", "controls"],
};

/** "2 value cards · 1 control", or "No widgets yet". */
export function widgetSummary(layout: Widget[]): string {
  if (layout.length === 0) return "No widgets yet";
  const byType = new Map<Widget["type"], number>();
  for (const w of layout) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
  return Array.from(byType, ([t, n]) => `${n} ${WIDGET_NAMES[t][n === 1 ? 0 : 1]}`).join(" · ");
}
