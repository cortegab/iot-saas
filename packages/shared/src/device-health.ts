/**
 * A connected device's health in one word (DESIGN.md §8 Health), so a person
 * who doesn't read dBm or heap sizes still knows whether to worry. The facts
 * stay underneath for whoever does. Offline, never connected and disabled are
 * not health words: the status beside the device's name already says them.
 */
import type { DotShape, StatusTone } from "./device-status";
import type { components } from "./api";
import { tActive } from "./i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export type HealthKey = "healthy" | "faults" | "restarted" | "weak_wifi" | "battery_low";

/** Restart reasons that mean something went wrong (firmware/src/diag.h). */
const FAULT_RESTARTS = new Set(["crash", "task_wdt", "interrupt_wdt", "other_wdt", "brownout"]);

/** Below this the link barely holds (signal.ts: "Very weak"). */
const WEAK_RSSI = -80;
const LOW_BATTERY_PCT = 15;

export const HEALTH: Record<HealthKey, { label: string; tone: StatusTone; shape: DotShape }> = {
  healthy: { get label() { return tActive("status.health.healthy"); }, tone: "online", shape: "solid" },
  faults: { get label() { return tActive("status.health.faults"); }, tone: "error", shape: "square" },
  restarted: { get label() { return tActive("status.health.restarted"); }, tone: "pending", shape: "square" },
  weak_wifi: { get label() { return tActive("status.health.weak_wifi"); }, tone: "pending", shape: "square" },
  battery_low: { get label() { return tActive("status.health.battery_low"); }, tone: "pending", shape: "square" },
};

type HealthInput = Pick<DeviceResponse, "status" | "connection_state"> &
  Partial<Pick<DeviceResponse, "rssi" | "battery_pct" | "reset_reason" | "faults">>;

/** The most pressing word for an online device, or null when its status
 * (offline, never connected, disabled) is the thing to say instead. */
export function healthKey(d: HealthInput): HealthKey | null {
  if (d.status === "disabled" || d.connection_state !== "online") return null;
  if ((d.faults ?? []).length > 0) return "faults";
  if (d.reset_reason != null && FAULT_RESTARTS.has(d.reset_reason)) return "restarted";
  if (d.rssi != null && d.rssi < WEAK_RSSI) return "weak_wifi";
  if (d.battery_pct != null && d.battery_pct < LOW_BATTERY_PCT) return "battery_low";
  return "healthy";
}

/** "2 sensors not answering" when there are several. */
export function healthLabel(key: HealthKey, d: Pick<HealthInput, "faults">): string {
  const n = (d.faults ?? []).length;
  return key === "faults" && n > 1 ? tActive("status.health.faultsMany", { count: n }) : HEALTH[key].label;
}
