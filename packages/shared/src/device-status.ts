/** The web's Badge tones and dot shapes (frontend components/ui/Badge.tsx),
 * which the app's status dot mirrors. */
export type StatusTone = "online" | "offline" | "unknown" | "pending" | "error" | "accent";
export type DotShape = "solid" | "hollow" | "square";
import type { components } from "./api";
import { tActive } from "./i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** DESIGN.md §3 device vocabulary: Online · Offline · Never connected ·
 * Disabled. A disabled device reads "Disabled" whatever its connection. */
export type DeviceStatusKey = "online" | "offline" | "never" | "disabled";

export const DEVICE_STATUS: Record<DeviceStatusKey, { label: string; tone: StatusTone; shape: DotShape; order: number }> = {
  // Labels read in the language on screen (DESIGN.md §11a).
  online: { get label() { return tActive("status.device.online"); }, tone: "online", shape: "solid", order: 0 },
  offline: { get label() { return tActive("status.device.offline"); }, tone: "offline", shape: "solid", order: 1 },
  never: { get label() { return tActive("status.device.never"); }, tone: "pending", shape: "hollow", order: 2 },
  disabled: { get label() { return tActive("status.device.disabled"); }, tone: "unknown", shape: "square", order: 3 },
};

export function deviceStatusKey(d: Pick<DeviceResponse, "status" | "connection_state">): DeviceStatusKey {
  if (d.status === "disabled") return "disabled";
  if (d.connection_state === "online") return "online";
  if (d.connection_state === "offline") return "offline";
  return "never";
}
