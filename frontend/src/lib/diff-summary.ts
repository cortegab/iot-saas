/**
 * Change lines for the post-save toast and version history (DESIGN.md §7,
 * §9.8): "Name: bay1 → bay1-climate", "2 changes: …".
 */

export interface DiffField<T> {
  label: string;
  get: (record: T) => unknown;
  /** Display a value; default: String(), "—" for empty. */
  format?: (value: unknown) => string;
}

const show = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
};

/** One line per changed field. */
export function diffLines<T>(before: T, after: T, fields: DiffField<T>[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    const a = f.get(before);
    const b = f.get(after);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const fmt = f.format ?? show;
    lines.push(`${f.label}: ${fmt(a)} → ${fmt(b)}`);
  }
  return lines;
}

/** "Name: a → b" for one change; "3 changes: first; second; +1 more" for more. */
export function changeSummary(lines: string[], max = 2): string {
  if (lines.length === 0) return "No changes";
  if (lines.length === 1) return lines[0];
  const shown = lines.slice(0, max).join("; ");
  const more = lines.length - max;
  return `${lines.length} changes: ${shown}${more > 0 ? `; +${more} more` : ""}`;
}
