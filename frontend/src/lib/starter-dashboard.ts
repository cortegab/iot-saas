import { isBoolMetric } from "@/lib/format-reading";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type Widget = components["schemas"]["Widget"];

/** At most this many devices, so a big workspace starts with a readable page. */
export const STARTER_DEVICES = 8;

/** "Build my dashboard" (DESIGN.md §10.2): one widget per device, two per row
 * on the 12-column grid. A trend chart of the device's first numeric reading,
 * or its status card when its template has none. A row is as tall as its
 * tallest widget, so nothing overlaps. */
export function starterLayout(
  devices: DeviceResponse[],
  templates: CatalogEntryResponse[],
  newId: () => string = () => crypto.randomUUID(),
): Widget[] {
  const widgets: Widget[] = [];
  let y = 0;
  let rowHeight = 0;
  devices.slice(0, STARTER_DEVICES).forEach((d, i) => {
    const metric = templates.find((t) => t.id === d.catalog_entry_id)?.metrics.find((m) => !isBoolMetric(m));
    const left = i % 2 === 0;
    if (left && i > 0) {
      y += rowHeight;
      rowHeight = 0;
    }
    const h = metric ? 4 : 2;
    rowHeight = Math.max(rowHeight, h);
    widgets.push({
      id: newId(),
      type: metric ? "trend_chart" : "device_status",
      x: left ? 0 : 6,
      y,
      w: 6,
      h,
      device_id: d.id,
      metric: metric ? wireId(metric) : null,
    });
  });
  return widgets;
}
