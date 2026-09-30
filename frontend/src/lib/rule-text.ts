/**
 * Short plain-text wording of a stored rule, for lists, tooltips and
 * toasts — the same words the rule sentence uses (DESIGN.md §9.5, §11).
 */

import { cronHuman } from "@/lib/schedule";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type ConditionLeaf = components["schemas"]["ConditionLeaf"];
type ConditionGroup = components["schemas"]["ConditionGroup-Output"];
type ConditionNode = ConditionLeaf | ConditionGroup;

const OP_SYMBOL: Record<string, string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "==": "=",
  "!=": "≠",
  between: "between",
  not_between: "outside",
  in: "in",
  not_in: "not in",
  changed: "changes",
  increased: "increases",
  decreased: "decreases",
};

function rhsText(leaf: ConditionLeaf): string {
  const rhs = leaf.rhs;
  if (!rhs) return "";
  if (rhs.source === "static") return String(rhs.value);
  if (rhs.source === "range") return `${rhs.low}–${rhs.high}`;
  if (rhs.source === "set") return rhs.values.join(", ");
  return rhs.metric;
}

/** "temperature > 27 and (humidity < 40 or door = 1)". */
export function conditionText(node: ConditionNode | null | undefined, nested = false): string {
  if (!node) return "";
  if (node.kind === "leaf") {
    const op = OP_SYMBOL[node.operator] ?? node.operator;
    const rhs = ["changed", "increased", "decreased"].includes(node.operator) ? "" : ` ${rhsText(node)}`;
    return `${node.metric} ${op}${rhs}`;
  }
  const inner = node.predicates.map((p) => conditionText(p, true)).join(node.op === "AND" ? " and " : " or ");
  return nested && node.predicates.length > 1 ? `(${inner})` : inner;
}

/** The "When" column: condition, schedule, run-now or device status. */
export function triggerText(rule: Pick<RuleResponse, "trigger" | "condition" | "devices">): string {
  const t = rule.trigger as Record<string, unknown>;
  const type = (t.type as string) ?? "metric";
  if (type === "schedule") return cronHuman(String(t.cron ?? ""));
  if (type === "manual") return "Run manually";
  if (type === "device_status") {
    const id = t.device_id as string | undefined;
    const name = rule.devices.find((d) => d.device_id === id)?.device_name ?? "a device";
    return `${name} ${t.transition === "connected" ? "connects" : "disconnects"}`;
  }
  return conditionText(rule.condition) || "—";
}

/** The "Then" column: "Turn fan1 on", "Email 2 people", "Call webhook"… */
export function actionsText(actions: Record<string, unknown>[]): string {
  if (actions.length === 0) return "Nothing";
  const parts = actions.map((a) => {
    switch (a.type) {
      case "actuator_command": {
        const v = a.value;
        const val = typeof v === "boolean" ? (v ? "on" : "off") : String(v);
        return `Turn ${String(a.actuator)} ${val}`;
      }
      case "email": {
        const to = Array.isArray(a.to) ? a.to : [];
        return to.length === 1 ? `Email ${String(to[0])}` : to.length > 1 ? `Email ${to.length} people` : "Email alert recipients";
      }
      case "webhook":
        return "Call webhook";
      case "notification":
        return "Notify in app";
      default:
        return "Unknown action";
    }
  });
  return parts.length > 2 ? `${parts[0]} +${parts.length - 1} more` : parts.join(", ");
}

/** Which device an actuator command targets: its own `device_id`, else the
 * rule's (single) target device. */
function commandTarget(rule: RuleResponse, action: Record<string, unknown>): string | null {
  if (typeof action.device_id === "string") return action.device_id;
  return rule.devices.find((d) => d.role === "target")?.device_id ?? rule.devices[0]?.device_id ?? null;
}

/** For each rule, the actuators it shares with another enabled rule
 * (DESIGN.md §9.4 / §9.9 — "shares fan1"). Computed client-side from the
 * rules list. */
export function sharedActuators(rules: RuleResponse[]): Map<string, string[]> {
  const byKey = new Map<string, Set<string>>();
  const keysByRule = new Map<string, Map<string, string>>();
  for (const r of rules) {
    if (!r.enabled) continue;
    const keys = new Map<string, string>();
    for (const a of [...r.actions, ...r.clear_actions]) {
      if (a.type !== "actuator_command") continue;
      const dev = commandTarget(r, a);
      if (!dev) continue;
      const key = `${dev}:${String(a.actuator)}`;
      keys.set(key, String(a.actuator));
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key)!.add(r.id);
    }
    keysByRule.set(r.id, keys);
  }
  const out = new Map<string, string[]>();
  for (const [ruleId, keys] of keysByRule) {
    const shared = [...keys].filter(([k]) => (byKey.get(k)?.size ?? 0) > 1).map(([, actuator]) => actuator);
    if (shared.length) out.set(ruleId, [...new Set(shared)]);
  }
  return out;
}

/** DESIGN.md §3 rule states available from the API today. */
export type RuleStateKey = "armed" | "latched" | "disabled";

export function ruleStateKey(r: Pick<RuleResponse, "enabled" | "latched">): RuleStateKey {
  if (!r.enabled) return "disabled";
  if (r.latched) return "latched";
  return "armed";
}
