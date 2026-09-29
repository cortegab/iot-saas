import type { components } from "@/types/api";

type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type TelemetryDataResponse = components["schemas"]["TelemetryDataResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

/**
 * SWR cache updaters that apply a live telemetry WebSocket frame directly,
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

export function markOnline(iso: string) {
  return (current: DeviceResponse | undefined): DeviceResponse | undefined => {
    if (!current) return current;
    if (current.connection_state === "online" && !isNewer(iso, current.last_seen_at)) return current;
    return { ...current, connection_state: "online", last_seen_at: iso };
  };
}

/** `windowMs`, when given, drops points that have slid out of the chart's
 * trailing window — the periodic refetch can't be relied on for that, since
 * SWR discards a refetch whenever a live frame mutates the key mid-flight
 * (routine for a device publishing every second). */
export function appendPoint(iso: string, value: number, windowMs?: number) {
  return (current: TelemetryDataResponse | undefined): TelemetryDataResponse | undefined => {
    if (!current) return current;
    const last = current.points[current.points.length - 1];
    if (last && !isNewer(iso, last.time)) return current;
    let points = [...current.points, { time: iso, value }];
    if (windowMs != null) {
      const cutoff = Date.now() - windowMs;
      const firstInWindow = points.findIndex((p) => new Date(p.time).getTime() >= cutoff);
      if (firstInWindow > 0) points = points.slice(firstInWindow);
    }
    return { ...current, points };
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
