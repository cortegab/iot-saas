import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

/**
 * SWR cache updaters that apply live telemetry (coalesced by lib/live-buffer) directly,
 * instead of invalidating and re-fetching (which races the ~1s DB batch
 * flush and returns the previous sample). Each is a pure factory returning
 * an SWR updater; when the key isn't cached yet the updater is a no-op and
 * the eventual fetch populates it. Used with `mutate(key, updater, {
 * revalidate: false })` — the existing refreshInterval / on-focus refetch
 * stays as the reconciling backstop.
 *
 * The WS frame's `time` is epoch seconds; every REST payload here uses ISO
 * strings, so callers pass `new Date(msg.time * 1000).toISOString()`.
 */

function isNewer(candidateIso: string, existingIso: string | null | undefined): boolean {
  if (!existingIso) return true;
  return new Date(candidateIso).getTime() > new Date(existingIso).getTime();
}

export function mergeLatest(metric: string, value: number, iso: string) {
  return (current: TelemetryLatestResponse[] | undefined): TelemetryLatestResponse[] | undefined => {
    if (!current) return current;
    const existing = current.find((r) => r.metric === metric);
    if (!existing) return [...current, { metric, value, time: iso }];
    if (!isNewer(iso, existing.time)) return current;
    // Replace in place — the device page treats index 0 as the primary
    // readout, so moving the updated metric to the end would swap it.
    return current.map((r) => (r.metric === metric ? { metric, value, time: iso } : r));
  };
}

/** Already-online devices only get a new `last_seen_at` once it moves a full
 * second: every rewrite re-renders the whole device page, and "last seen"
 * never shows finer than seconds. */
export function markOnline(iso: string) {
  return (current: DeviceResponse | undefined): DeviceResponse | undefined => {
    if (!current) return current;
    if (
      current.connection_state === "online" &&
      current.last_seen_at &&
      new Date(iso).getTime() - new Date(current.last_seen_at).getTime() < 1000
    ) {
      return current;
    }
    return { ...current, connection_state: "online", last_seen_at: iso };
  };
}

/** Applies a `device_health` WS frame (a retained {tenant}/{device}/status
 * message relayed live, see CLAUDE.md §4) — push-driven and authoritative,
 * so unlike markOnline above this always overwrites connection_state rather
 * than only ever moving it toward "online".
 */
export function applyDeviceHealth(fields: {
  online: boolean;
  rssi: number | null;
  battery_pct: number | null;
  uptime_s: number | null;
  fw_version: string | null;
}) {
  return (current: DeviceResponse | undefined): DeviceResponse | undefined => {
    if (!current) return current;
    return {
      ...current,
      connection_state: fields.online ? "online" : "offline",
      rssi: fields.rssi,
      battery_pct: fields.battery_pct,
      uptime_s: fields.uptime_s,
      fw_version: fields.fw_version,
    };
  };
}
