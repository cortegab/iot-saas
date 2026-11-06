import type { components } from "@iodriven/shared/api";
import { actionsText, ruleStateKey, triggerText, type RuleStateKey } from "@iodriven/shared/rule-text";

type RuleResponse = components["schemas"]["RuleResponse"];

/** The rules list's filter (the web's state filter, DESIGN.md §6 / §8). */
export type RuleFilter = "all" | RuleStateKey | "stale";

export function matchesFilter(r: RuleResponse, filter: RuleFilter): boolean {
  if (filter === "all") return true;
  if (filter === "stale") return r.enabled && !r.health.evaluatable;
  return ruleStateKey(r) === filter;
}

export function ruleCounts(rules: RuleResponse[]): Record<RuleFilter, number> {
  const c: Record<RuleFilter, number> = { all: rules.length, armed: 0, latched: 0, disabled: 0, stale: 0 };
  for (const r of rules) {
    c[ruleStateKey(r)] += 1;
    if (r.enabled && !r.health.evaluatable) c.stale += 1;
  }
  return c;
}

/** "When temperature > 27 → turn fan1 On", in the web's words. Never throws:
 * a rule shape this build doesn't know reads as its trigger kind. */
export function ruleSentence(r: RuleResponse): string {
  try {
    const when = triggerText(r);
    const then = actionsText(r.actions);
    return then ? `When ${when} → ${then.charAt(0).toLowerCase()}${then.slice(1)}` : `When ${when}`;
  } catch {
    return "Open on the web to see what it does";
  }
}

export function scheduleOrNull(r: RuleResponse): string | null {
  if ((r.trigger as Record<string, unknown>).type !== "schedule") return null;
  try {
    return triggerText(r);
  } catch {
    return "On a schedule";
  }
}
