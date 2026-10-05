/** Time wording (DESIGN.md §11): 24-hour; recent times relative ("3 h ago"),
 * older ones absolute ("Fri 2 Oct 22:00"). */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "just now" · "12 min ago" · "3 h ago" · "2 d ago" · beyond a week the
 * absolute date. `null` → "never". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatWhen(iso);
}

/** "Fri 2 Oct 22:00" in the viewer's zone (or `timeZone`). */
export function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
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
