/**
 * The one time zone list (DESIGN.md §9.6): IANA values, labelled
 * "City (GMT±h)" with the offset computed for today (so daylight saving is
 * right), grouped by region and sorted by offset, then city. Used by rule
 * schedules and Workspace settings — never hand-roll another.
 */

export const TZ_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "Americas",
    [
      "America/Anchorage",
      "America/Los_Angeles",
      "America/Denver",
      "America/Mexico_City",
      "America/Chicago",
      "America/Guatemala",
      "America/Bogota",
      "America/Lima",
      "America/New_York",
      "America/Caracas",
      "America/Santiago",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
    ],
  ],
  [
    "Europe & Africa",
    [
      "Atlantic/Azores",
      "Europe/London",
      "Europe/Lisbon",
      "Africa/Lagos",
      "Europe/Madrid",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Oslo",
      "Europe/Stockholm",
      "Africa/Cairo",
      "Africa/Johannesburg",
      "Europe/Helsinki",
      "Europe/Istanbul",
      "Africa/Nairobi",
    ],
  ],
  [
    "Asia & Pacific",
    [
      "Asia/Dubai",
      "Asia/Karachi",
      "Asia/Kolkata",
      "Asia/Bangkok",
      "Asia/Jakarta",
      "Asia/Shanghai",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Perth",
      "Australia/Sydney",
      "Pacific/Auckland",
      "Pacific/Honolulu",
    ],
  ],
  ["Other", ["UTC"]],
];

export const KNOWN_TIMEZONES: readonly string[] = TZ_GROUPS.flatMap(([, zs]) => zs);

/** "America/Mexico_City" → "Mexico City". */
export function tzCity(zone: string): string {
  if (zone === "UTC") return "UTC";
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** Today's offset as "GMT-6", "GMT+5:30", "GMT+0". Empty for an unknown zone. */
export function tzOffset(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part || part === "GMT") return "GMT+0";
    return part;
  } catch {
    return "";
  }
}

/** "GMT-6" → -360; "GMT+5:30" → 330. */
export function offsetMinutes(offset: string): number {
  const m = offset.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** "Mexico City (GMT-6)". */
export function tzLabel(zone: string, at: Date = new Date()): string {
  const off = tzOffset(zone, at);
  return off ? `${tzCity(zone)} (${off})` : tzCity(zone);
}

export interface TzOptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

/** Grouped options, each group sorted by offset then city. A `selected` zone
 * that isn't in the list is prepended so it still shows as selected. */
export function timezoneOptions(selected?: string, at: Date = new Date()): {
  extra: { value: string; label: string } | null;
  groups: TzOptionGroup[];
} {
  const groups = TZ_GROUPS.map(([label, zones]) => ({
    label,
    options: [...zones]
      .sort(
        (a, b) =>
          offsetMinutes(tzOffset(a, at)) - offsetMinutes(tzOffset(b, at)) || tzCity(a).localeCompare(tzCity(b)),
      )
      .map((z) => ({ value: z, label: tzLabel(z, at) })),
  }));
  const extra =
    selected && !KNOWN_TIMEZONES.includes(selected) ? { value: selected, label: tzLabel(selected, at) } : null;
  return { extra, groups };
}

/** Is this a zone the runtime understands? */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
