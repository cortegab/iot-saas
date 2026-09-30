/**
 * Schedule picker model (DESIGN.md §9.5). Cron stays the stored format; this
 * module maps a 5-field cron to the plain modes the picker shows (and back),
 * words it the same way everywhere, and computes the next runs in the rule's
 * time zone.
 */

import { tzCity, tzOffset } from "@/lib/timezones";

export type ScheduleMode = "daily" | "days" | "every" | "monthly" | "custom";

export interface ScheduleModel {
  mode: ScheduleMode;
  /** "HH:MM", 24-hour. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Day of month, 1–28. */
  dom: number;
  n: number;
  unit: "min" | "h";
  /** Minute past the hour for hourly repeats. */
  at: number;
}

export const DEFAULT_SCHEDULE: ScheduleModel = {
  mode: "daily",
  time: "08:00",
  days: [1, 2, 3, 4, 5],
  dom: 1,
  n: 15,
  unit: "min",
  at: 0,
};

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** Display order: Monday first. */
export const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** One cron field → sorted allowed values, or null when it isn't readable.
 * Supports numbers, `*`, ranges, lists and steps. Weekday 7 folds to 0. */
export function cronField(field: string, lo: number, hi: number): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    let a: number;
    let b: number | undefined;
    if (m[1] === "*") {
      a = lo;
      b = hi;
    } else {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y;
    }
    if (b == null) b = m[2] ? hi : a;
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(hi === 7 && v === 7 ? 0 : v);
  }
  return [...out].sort((x, y) => x - y);
}

export interface CronParts {
  raw: [string, string, string, string, string];
  minutes: number[];
  hours: number[];
  dom: number[];
  months: number[];
  dow: number[];
}

export function cronParts(cron: string): CronParts | null {
  const p = (cron || "").trim().split(/\s+/);
  if (p.length !== 5) return null;
  const f = [
    cronField(p[0], 0, 59),
    cronField(p[1], 0, 23),
    cronField(p[2], 1, 31),
    cronField(p[3], 1, 12),
    cronField(p[4], 0, 7),
  ];
  if (f.some((x) => !x || x.length === 0)) return null;
  return {
    raw: p as CronParts["raw"],
    minutes: f[0]!,
    hours: f[1]!,
    dom: f[2]!,
    months: f[3]!,
    dow: f[4]!,
  };
}

/** Plain-language error for a cron that can't be read, or null. */
export function validateCron(cron: string): string | null {
  const p = (cron || "").trim().split(/\s+/).filter(Boolean);
  if (p.length !== 5) return "Enter five fields: minute, hour, day, month, weekday.";
  if (!cronParts(cron)) {
    return "One of the fields isn't valid. Use numbers, *, ranges (1-5), lists (1,3) or steps (*/15).";
  }
  return null;
}

const isNum = (x: string) => /^\d+$/.test(x);

/** Cron → the simple model the picker can show; `{ mode: "custom" }` when the
 * simple controls can't represent it. */
export function scheduleFromCron(cron: string): Partial<ScheduleModel> & { mode: ScheduleMode } {
  const P = cronParts(cron);
  if (!P) return { mode: "custom" };
  const [mi, h, dom, mon, dow] = P.raw;
  const time = isNum(mi) && isNum(h) ? `${pad2(Number(h))}:${pad2(Number(mi))}` : null;
  if (mon !== "*") return { mode: "custom" };
  if (time && dom === "*" && dow === "*") return { mode: "daily", time };
  if (time && dom === "*") return { mode: "days", time, days: P.dow };
  if (time && isNum(dom) && dow === "*" && Number(dom) <= 28) return { mode: "monthly", time, dom: Number(dom) };
  if (dom === "*" && dow === "*") {
    let m = mi.match(/^\*\/(\d+)$/);
    if (m && h === "*") return { mode: "every", n: Number(m[1]), unit: "min" };
    m = h.match(/^\*\/(\d+)$/);
    if (m && isNum(mi)) return { mode: "every", n: Number(m[1]), unit: "h", at: Number(mi) };
    if (isNum(mi) && h === "*") return { mode: "every", n: 1, unit: "h", at: Number(mi) };
  }
  return { mode: "custom" };
}

/** The simple model → cron. Returns null for `custom` (the typed cron wins). */
export function cronFromSchedule(s: ScheduleModel): string | null {
  const [hh, mm] = s.time.split(":").map(Number);
  switch (s.mode) {
    case "daily":
      return `${mm} ${hh} * * *`;
    case "days": {
      const d = [...s.days].sort((a, b) => a - b).join(",");
      return `${mm} ${hh} * * ${d === "1,2,3,4,5" ? "1-5" : d}`;
    }
    case "monthly":
      return `${mm} ${hh} ${s.dom} * *`;
    case "every": {
      const n = clampRepeat(s.n, s.unit);
      if (s.unit === "min") return `*/${n} * * * *`;
      return n === 1 ? `${s.at} * * * *` : `${s.at} */${n} * * *`;
    }
    case "custom":
      return null;
  }
}

/** Minutes 1–59, hours 1–23. */
export function clampRepeat(n: number, unit: "min" | "h"): number {
  const v = Math.round(Number(n)) || 1;
  return Math.max(1, Math.min(unit === "min" ? 59 : 23, v));
}

export function daysText(days: number[]): string {
  const k = [...days].sort((a, b) => a - b).join(",");
  if (k === "1,2,3,4,5") return "weekdays";
  if (k === "0,6") return "weekends";
  if (days.length === 7) return "every day";
  return DOW_ORDER.filter((d) => days.includes(d))
    .map((d) => DOW[d])
    .join(", ");
}

/** The one wording for a schedule (sentence, rules list, versions):
 * "every day at 22:00", "Tue, Thu at 07:30", "every 15 min",
 * "on the 1st of each month at 09:00", "weekdays at 08:00 and 20:00". */
export function cronHuman(cron: string): string {
  const s = scheduleFromCron(cron);
  if (s.mode === "daily") return `every day at ${s.time}`;
  if (s.mode === "days") return `${daysText(s.days ?? [])} at ${s.time}`;
  if (s.mode === "monthly") return `on the ${ordinal(s.dom ?? 1)} of each month at ${s.time}`;
  if (s.mode === "every") {
    if (s.unit === "min") return `every ${s.n} min`;
    return s.n === 1 ? `every hour at :${pad2(s.at ?? 0)}` : `every ${s.n} hours at :${pad2(s.at ?? 0)}`;
  }
  const P = cronParts(cron);
  if (!P) return "invalid schedule";
  const [, , dom, mon, dow] = P.raw;
  const times =
    P.minutes.length * P.hours.length <= 4
      ? P.hours.flatMap((hh) => P.minutes.map((m) => `${pad2(hh)}:${pad2(m)}`))
      : null;
  let when: string | null = null;
  if (mon === "*") {
    if (dom === "*" && dow === "*") when = "every day";
    else if (dom === "*") when = daysText(P.dow);
    else if (dow === "*" && P.dom.length === 1) when = `on the ${ordinal(P.dom[0])} of each month`;
  }
  if (times && when) {
    const last = times[times.length - 1];
    return `${when} at ${times.slice(0, -1).join(", ")}${times.length > 1 ? " and " : ""}${last}`;
  }
  return "on a custom schedule";
}

/** A wall-clock moment in a given zone. */
export interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0 = Sunday
}

/** The current wall-clock time in `zone`. */
export function wallNow(zone: string, at: Date = new Date()): WallTime {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return wallNow("UTC", at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    dow: DOW.indexOf(get("weekday") as (typeof DOW)[number]),
  };
}

/** Calendar arithmetic on a plain date (no zone involved). */
function addDays(y: number, m: number, d: number, n: number): { year: number; month: number; day: number; dow: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), dow: t.getUTCDay() };
}

/** The next `n` runs of `cron` as wall-clock times in `zone`, strictly after
 * `from` (default: now). Follows cron's day rule: when both day-of-month and
 * weekday are restricted, either may match. */
export function nextRuns(cron: string, zone: string, n = 3, from: Date = new Date()): WallTime[] {
  const P = cronParts(cron);
  if (!P) return [];
  const now = wallNow(zone, from);
  const domAny = P.raw[2] === "*";
  const dowAny = P.raw[4] === "*";
  const out: WallTime[] = [];
  for (let i = 0; i < 400 && out.length < n; i++) {
    const day = addDays(now.year, now.month, now.day, i);
    if (!P.months.includes(day.month)) continue;
    const dayOk =
      domAny && dowAny
        ? true
        : domAny
          ? P.dow.includes(day.dow)
          : dowAny
            ? P.dom.includes(day.day)
            : P.dom.includes(day.day) || P.dow.includes(day.dow);
    if (!dayOk) continue;
    for (const hour of P.hours) {
      for (const minute of P.minutes) {
        if (i === 0 && (hour < now.hour || (hour === now.hour && minute <= now.minute))) continue;
        out.push({ ...day, hour, minute });
        if (out.length >= n) return out;
      }
    }
  }
  return out;
}

/** "Today 22:00" · "Tomorrow 22:00" · "Fri 2 Oct 22:00" — relative to today
 * in the same zone. */
export function runText(run: WallTime, zone: string, from: Date = new Date()): string {
  const today = wallNow(zone, from);
  const a = Date.UTC(today.year, today.month - 1, today.day);
  const b = Date.UTC(run.year, run.month - 1, run.day);
  const diff = Math.round((b - a) / 864e5);
  const hm = `${pad2(run.hour)}:${pad2(run.minute)}`;
  if (diff === 0) return `Today ${hm}`;
  if (diff === 1) return `Tomorrow ${hm}`;
  return `${DOW[run.dow]} ${run.day} ${MONTHS[run.month - 1]} ${hm}`;
}

/** "Runs weekdays at 22:00 (Mexico City, GMT-6)" parts for the summary line. */
export function scheduleSummary(
  cron: string,
  zone: string,
  from: Date = new Date(),
): { valid: false } | { valid: true; human: string; zone: string; runs: string[] } {
  if (!cronParts(cron)) return { valid: false };
  return {
    valid: true,
    human: cronHuman(cron),
    zone: `${tzCity(zone)}, ${tzOffset(zone, from)}`,
    runs: nextRuns(cron, zone, 3, from).map((r) => runText(r, zone, from)),
  };
}
