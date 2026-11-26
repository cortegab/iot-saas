/**
 * A notification in the reader's language (DESIGN.md §11a; Spanish plan L8).
 * The platform's own notifications carry `i18n` (a message key and values);
 * this words them with the shared catalog. A person's own message, an older
 * row or an unknown key falls back to the stored English text.
 */
import { tActive, type MessageKey } from "./i18n";

interface Keyed {
  key?: unknown;
  params?: unknown;
}
export interface NotificationLike {
  message: string;
  detail?: string | null;
  i18n?: Record<string, unknown> | null;
}

type Node = {
  kind?: string;
  op?: string;
  predicates?: Node[];
  metric?: string;
  operator?: string;
  rhs?: { source?: string; value?: unknown; metric?: string; low?: unknown; high?: unknown; values?: unknown[] } | null;
  current?: number | null;
};

const OPS: Record<string, string> = {
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  "==": "eq",
  "!=": "ne",
  between: "between",
  not_between: "not_between",
  in: "in",
  not_in: "not_in",
  changed: "changed",
  increased: "increased",
  decreased: "decreased",
};
const CHANGE = new Set(["changed", "increased", "decreased"]);

function rhsText(node: Node): string {
  if (CHANGE.has(node.operator ?? "")) return "";
  const r = node.rhs ?? {};
  if (r.source === "static") return ` ${String(r.value)}`;
  if (r.source === "metric") return ` ${String(r.metric)}`;
  if (r.source === "range") return ` ${tActive("notif.range", { low: String(r.low), high: String(r.high) })}`;
  if (r.source === "set") return ` ${(r.values ?? []).map(String).join(", ")}`;
  return "";
}

/** "temp goes above 30 (currently 31.5) and hum drops below 40". */
export function conditionWords(node: Node): string {
  if (node.kind === "leaf") {
    const op = OPS[node.operator ?? ""];
    const opText = op ? tActive(`notif.ops.${op}` as MessageKey) : (node.operator ?? "");
    const current = node.current != null ? tActive("notif.current", { value: String(node.current) }) : "";
    return `${node.metric ?? ""} ${opText}${rhsText(node)}${current}`;
  }
  const join = tActive(node.op === "AND" ? "ruleText.and" : "ruleText.or");
  return (node.predicates ?? []).map(conditionWords).join(join);
}

function word(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const { key, params } = part as Keyed;
  if (typeof key !== "string") return null;
  const full = `notif.${key}` as MessageKey;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries((params as Record<string, unknown>) ?? {})) {
    values[k] = k === "condition" && v && typeof v === "object" ? conditionWords(v as Node) : String(v);
  }
  const out = tActive(full, values);
  return out === full ? null : out;
}

/** The notification's title and detail in the language on screen. */
export function notificationText(n: NotificationLike): { message: string; detail: string | null } {
  const i18n = n.i18n ?? null;
  return {
    message: (i18n && word(i18n.message)) ?? n.message,
    detail: (i18n && word(i18n.detail)) ?? n.detail ?? null,
  };
}
