/**
 * Short plain-text wording of a stored rule, for lists, tooltips and
 * toasts — the same words the rule sentence uses (DESIGN.md §9.5, §11).
 */

import { cronHuman } from "./schedule";
import { tActive } from "./i18n";
import type { components } from "./api";

type RuleResponse = components["schemas"]["RuleResponse"];
type ConditionLeaf = components["schemas"]["ConditionLeaf"];
type ConditionGroup = components["schemas"]["ConditionGroup-Output"];
type ConditionNode = ConditionLeaf | ConditionGroup;

const OP_SYMBOL: Record<string, string> = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "==": "=", "!=": "≠" };
const OP_WORDS = ["between", "not_between", "in", "not_in", "changed", "increased", "decreased"] as const;

/** An operator as the sentence writes it: a symbol, or a word in the
 * language on screen ("between" / "entre"). */
function opText(op: string): string {
  if (op in OP_SYMBOL) return OP_SYMBOL[op];
  return (OP_WORDS as readonly string[]).includes(op) ? tActive(`ruleText.ops.${op as (typeof OP_WORDS)[number]}`) : op;
}

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
    const op = opText(node.operator);
    const rhs = ["changed", "increased", "decreased"].includes(node.operator) ? "" : ` ${rhsText(node)}`;
    return `${node.metric} ${op}${rhs}`;
  }
  const inner = node.predicates.map((p) => conditionText(p, true)).join(tActive(node.op === "AND" ? "ruleText.and" : "ruleText.or"));
  return nested && node.predicates.length > 1 ? `(${inner})` : inner;
}

/** The "When" column: condition, schedule, run-now or device status. */
export function triggerText(rule: Pick<RuleResponse, "trigger" | "condition" | "devices">): string {
  const t = rule.trigger as Record<string, unknown>;
  const type = (t.type as string) ?? "metric";
  if (type === "schedule") return cronHuman(String(t.cron ?? ""));
  if (type === "manual") return tActive("ruleText.runManually");
  if (type === "device_status") {
    const id = t.device_id as string | undefined;
    const name = rule.devices.find((d) => d.device_id === id)?.device_name ?? tActive("ruleText.aDevice");
    return tActive(t.transition === "connected" ? "ruleText.connects" : "ruleText.disconnects", { name });
  }
  return conditionText(rule.condition) || "—";
}

/** The "Then" column: "Turn fan1 on", "Email 2 people", "Call webhook"… */
export function actionsText(actions: Record<string, unknown>[]): string {
  if (actions.length === 0) return tActive("ruleText.nothing");
  const parts = actions.map((a) => {
    switch (a.type) {
      case "actuator_command": {
        const v = a.value;
        const actuator = String(a.actuator);
        if (typeof v === "boolean") return tActive(v ? "ruleText.turnOn" : "ruleText.turnOff", { actuator });
        return tActive("ruleText.setTo", { actuator, value: String(v) });
      }
      case "email": {
        const to = Array.isArray(a.to) ? a.to : [];
        return to.length === 1
          ? tActive("ruleText.emailOne", { to: String(to[0]) })
          : to.length > 1
            ? tActive("ruleText.emailMany", { count: to.length })
            : tActive("ruleText.emailRecipients");
      }
      case "webhook":
        return tActive("ruleText.webhook");
      case "notification":
        return tActive("ruleText.notification");
      default:
        return tActive("ruleText.unknownAction");
    }
  });
  return parts.length > 2 ? tActive("ruleText.more", { first: parts[0], count: parts.length - 1 }) : parts.join(", ");
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
export type RuleStateKey = "armed" | "stale" | "latched" | "disabled";

/** One state per rule: an enabled rule whose inputs have no fresh data is
 * "Can't evaluate", never "Armed" as well. Disabled and latched win, since
 * they ask someone to act. `health` is optional for callers that lack it. */
export function ruleStateKey(r: Pick<RuleResponse, "enabled" | "latched"> & { health?: { evaluatable: boolean } | null }): RuleStateKey {
  if (!r.enabled) return "disabled";
  if (r.latched) return "latched";
  if (r.health && !r.health.evaluatable) return "stale";
  return "armed";
}

/** How each state reads as a badge (rules list, rule page, peek, device Rules tab). */
export const RULE_STATE: Record<RuleStateKey, { label: string; tone: "online" | "pending" | "unknown"; shape: "solid" | "square" | "hollow" }> = {
  armed: { get label() { return tActive("status.rule.armed"); }, tone: "online", shape: "solid" },
  stale: { get label() { return tActive("status.rule.stale"); }, tone: "unknown", shape: "hollow" },
  latched: { get label() { return tActive("status.rule.latched"); }, tone: "pending", shape: "square" },
  disabled: { get label() { return tActive("status.rule.disabled"); }, tone: "unknown", shape: "square" },
};

/** The rules list's Trigger column (demo H): what starts it, in words. */
export function triggerKindText(rule: Pick<RuleResponse, "trigger" | "condition" | "devices">): string {
  return (rule.trigger as Record<string, unknown>).type === "metric" || !(rule.trigger as Record<string, unknown>).type ? tActive("ruleText.onEachReading") : triggerText(rule);
}
