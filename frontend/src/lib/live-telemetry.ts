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
    if (existing && !isNewer(iso, existing.time)) return current;
    const next = current.filter((r) => r.metric !== metric);
    next.push({ metric, value, time: iso });
    return next;
  };
}

export function markOnline(iso: string) {
  return (current: DeviceResponse | undefined): DeviceResponse | undefined => {
    if (!current) return current;
    if (current.connection_state === "online" && !isNewer(iso, current.last_seen_at)) return current;
    return { ...current, connection_state: "online", last_seen_at: iso };
  };
}

export function appendPoint(iso: string, value: number) {
  return (current: TelemetryDataResponse | undefined): TelemetryDataResponse | undefined => {
    if (!current) return current;
    const last = current.points[current.points.length - 1];
    if (last && !isNewer(iso, last.time)) return current;
    return { ...current, points: [...current.points, { time: iso, value }] };
  };
}
