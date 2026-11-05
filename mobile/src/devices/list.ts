import type { components } from "@iodriven/shared/api";
import { DEVICE_STATUS, deviceStatusKey, type DeviceStatusKey } from "@iodriven/shared/device-status";

type DeviceResponse = components["schemas"]["DeviceResponse"];
export type StatusFilter = "all" | DeviceStatusKey;

/** Every word of the query appears in the name (the web list's search). */
export function matchesQuery(query: string, name: string): boolean {
  const hay = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** The devices the list shows: by status filter and search, online first
 * (DEVICE_STATUS order), then by name. */
export function visibleDevices(devices: DeviceResponse[], filter: StatusFilter, query: string): DeviceResponse[] {
  return devices
    .filter((d) => (filter === "all" || deviceStatusKey(d) === filter) && matchesQuery(query, d.name))
    .sort((a, b) => DEVICE_STATUS[deviceStatusKey(a)].order - DEVICE_STATUS[deviceStatusKey(b)].order || a.name.localeCompare(b.name));
}

export function statusCounts(devices: DeviceResponse[]): Record<DeviceStatusKey, number> {
  const c: Record<DeviceStatusKey, number> = { online: 0, offline: 0, never: 0, disabled: 0 };
  for (const d of devices) c[deviceStatusKey(d)]++;
  return c;
}
