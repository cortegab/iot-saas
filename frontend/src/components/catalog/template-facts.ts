import type { Fact } from "@/components/ui/FactList";
import { wireId, type WireNamed } from "@/lib/wire-id";

const names = (rows: WireNamed[]) => (rows.length ? rows.map((r) => r.name || wireId(r)).join(", ") : "None");

/** What a template gives each of its devices, worded the same wherever it's
 * shown (Add device, a device's Settings): Metrics and Actuators (DESIGN.md §11). */
export function templateGivesFacts(template: { metrics: WireNamed[]; actuators: WireNamed[] }): Fact[] {
  return [
    ["Metrics", names(template.metrics)],
    ["Actuators", names(template.actuators)],
  ];
}
