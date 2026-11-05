/** The web's Badge tones and dot shapes (frontend components/ui/Badge.tsx),
 * which the app's status dot mirrors. */
export type StatusTone = "online" | "offline" | "unknown" | "pending" | "error" | "accent";
export type DotShape = "solid" | "hollow" | "square";
import type { components } from "./api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** DESIGN.md §3 device vocabulary: Online · Offline · Never connected ·
 * Disabled. A disabled device reads "Disabled" whatever its connection. */
export type DeviceStatusKey = "online" | "offline" | "never" | "disabled";

export const DEVICE_STATUS: Record<DeviceStatusKey, { label: string; tone: StatusTone; shape: DotShape; order: number }> = {
  online: { label: "Online", tone: "online", shape: "solid", order: 0 },
  offline: { label: "Offline", tone: "offline", shape: "solid", order: 1 },
  never: { label: "Never connected", tone: "pending", shape: "hollow", order: 2 },
  disabled: { label: "Disabled", tone: "unknown", shape: "square", order: 3 },
};

export function deviceStatusKey(d: Pick<DeviceResponse, "status" | "connection_state">): DeviceStatusKey {
  if (d.status === "disabled") return "disabled";
  if (d.connection_state === "online") return "online";
  if (d.connection_state === "offline") return "offline";
  return "never";
}
