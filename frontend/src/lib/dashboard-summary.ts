import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type Widget = components["schemas"]["Widget"];

/** "2 value cards · 1 control", or "No widgets yet". */
export function widgetSummary(layout: Widget[]): string {
  if (layout.length === 0) return tr("wsum.none");
  const byType = new Map<Widget["type"], number>();
  for (const w of layout) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
  return Array.from(byType, ([t, n]) => tr(`wsum.${t}`, { count: n })).join(" · ");
}
