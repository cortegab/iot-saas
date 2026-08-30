import { slugify } from "@/lib/slug";

/** Anything with a display name and an optional explicit wire key — catalog
 * metrics and actuators, and the firmware-sketch entries derived from them. */
export interface WireNamed {
  name: string;
  key?: string | null;
}

/** The wire identifier for a metric/actuator: the author's explicit `key` if
 * set, otherwise the slugified display name. This is the MQTT topic segment
 * the device publishes/subscribes on, so every call site that builds a topic
 * or matches an incoming one must agree — hence one helper, not a copy per
 * file. The backend re-derives the same value authoritatively on submit
 * (`app.shared.slug`), so a drift here is cosmetic, never a routing bug. */
export function wireId(entry: WireNamed): string {
  return entry.key || slugify(entry.name);
}
