import type { components } from "@iodriven/shared/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type Widget = components["schemas"]["Widget"];

/** The list: your default first, then by name. */
export function sortDashboards(list: DashboardResponse[]): DashboardResponse[] {
  return [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

/** A phone shows widgets one per row in reading order: top to bottom, then
 * left to right (the web's phone layout, DESIGN.md §8). */
export function readingOrder(layout: Widget[]): Widget[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
}
