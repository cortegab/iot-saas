import type { Fact } from "@/components/ui/FactList";
import { wireId, type WireNamed } from "@/lib/wire-id";
import { tActive as tr } from "@iodriven/shared/i18n";

const names = (rows: WireNamed[]) => (rows.length ? rows.map((r) => r.name || wireId(r)).join(", ") : tr("tpl.none"));

/** What a template gives each of its devices, worded the same wherever it's
 * shown (Add device, a device's Settings): Metrics and Actuators (DESIGN.md §11). */
export function templateGivesFacts(template: { metrics: WireNamed[]; actuators: WireNamed[] }): Fact[] {
  return [
    [tr("tpl.metrics"), names(template.metrics)],
    [tr("tpl.actuators"), names(template.actuators)],
  ];
}
