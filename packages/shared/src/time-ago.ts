/** Time wording (DESIGN.md §11): 24-hour; recent times relative ("3 h ago"),
 * older ones absolute ("Fri 2 Oct 22:00"). */

import { activeLocale, formatDate as formatDateIntl, formatDateTime, tActive } from "./i18n";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "just now" · "12 min ago" · "3 h ago" · "2 d ago" · beyond a week the
 * absolute date. `null` → "never". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return tActive("time.never");
  const t = new Date(iso).getTime();
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return tActive("time.justNow");
  if (minutes < 60) return tActive("time.minAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tActive("time.hAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return tActive("time.dAgo", { n: days });
  return formatWhen(iso);
}

/** "Fri 2 Oct 22:00" in the viewer's zone (or `timeZone`). */
export function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  // Spanish: "lun 2 oct 22:00" through Intl, in the reader's country style.
  if (activeLocale() !== "en") return formatDateTime(activeLocale(), d, timeZone).replace(",", "").replace(/\./g, "");
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
  }
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Minutes since `iso`, for sorting by recency (`null` sorts last). */
export function ageMinutes(iso: string | null | undefined, now: number = Date.now()): number | null {
  return iso ? Math.floor((now - new Date(iso).getTime()) / 60_000) : null;
}

/** "30 Oct 2026" — calendar dates where the hour doesn't matter (expiry,
 * joined). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (activeLocale() !== "en") return formatDateIntl(activeLocale(), d).replace(/\./g, "");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
