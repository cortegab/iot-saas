import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** The template's declared actuators are the primary source — an actuator a
 * rule commands *on this device* is unioned in too, so a control never
 * disappears for an actuator an active rule still drives even if it was
 * since dropped from the template. A rule listed here may only use this
 * device as a condition input while its action targets another device — so
 * an `actuator_command` action counts only when its `device_id` is this
 * device (or absent, for pre-multi-device data). `id` is the stable wire id
 * (catalog `key`, or a slugified `name`); `label` is the pretty catalog
 * name — a rule's raw actuator string has no known label, so it's shown
 * as-is. */
export function getDeviceActuators(
  catalogEntry: CatalogEntryResponse | undefined,
  rules: RuleResponse[] | undefined,
  deviceId: string,
): { id: string; label: string }[] {
  const options = new Map<string, string>();
  for (const a of catalogEntry?.actuators ?? []) {
    const id = wireId(a);
    if (!options.has(id)) options.set(id, a.name);
  }
  for (const rule of rules ?? []) {
    for (const raw of rule.actions) {
      if (
        raw.type === "actuator_command" &&
        typeof raw.actuator === "string" &&
        (raw.device_id == null || raw.device_id === deviceId) &&
        !options.has(raw.actuator)
      ) {
        options.set(raw.actuator, raw.actuator);
      }
    }
  }
  return Array.from(options, ([id, label]) => ({ id, label }));
}
