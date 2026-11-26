import type { components } from "./api";
import { timeAgo } from "./time-ago";
import { tActive } from "./i18n";

type RuleResponse = components["schemas"]["RuleResponse"];
type SimulateResponse = components["schemas"]["SimulateResponse"];

/** Whether a rule drives an actuator (on firing or on clear) or latches:
 * disabling it leaves equipment unprotected, so the apps ask first. */
export function guardsHardware(rule: Pick<RuleResponse, "actions" | "clear_actions" | "execution_policy">): boolean {
  const acts = [...rule.actions, ...(rule.clear_actions ?? [])];
  return acts.some((a) => a.type === "actuator_command") || rule.execution_policy?.strategy === "latch";
}

/** In the language on screen (a getter, read when shown). */
export const RULE_SAFETY = {
  get disableGuarded(): string {
    return tActive("rules.actions.guarded");
  },
};
/** @deprecated read RULE_SAFETY.disableGuarded (follows the language). */
export const DISABLE_GUARDED_RULE = "Its actuators stay in their current state, and nothing will switch them for this rule until it's enabled again.";

/** What resetting a latched rule will do now (DESIGN.md §9.8), from a dry run
 * of it; null when the dry run failed. A reset can switch hardware again. */
export function resetLatchVerdict(sim: SimulateResponse | null): string {
  if (sim == null) return tActive("rules.actions.verdictUnknown");
  if (sim.unavailable_signals.length > 0) return tActive("rules.actions.verdictMissing");
  return tActive(sim.would_fire ? "rules.actions.verdictFires" : "rules.actions.verdictQuiet");
}

/** The readings a latched rule's condition reads, as lines for its reset
 * confirmation: "level on Tank 1: 12.5 · 2 min ago". */
export function resetLatchReadings(rule: Pick<RuleResponse, "health">, now: number = Date.now()): string[] {
  return rule.health.signals.map((s) => {
    const value = s.last_value ?? "—";
    const when = s.state === "fresh" && s.last_seen_at ? timeAgo(s.last_seen_at, now) : s.state;
    return `${tActive("rules.actions.reading", { metric: s.metric, device: s.device_name ?? tActive("rules.page.aDevice") })}: ${value} · ${when}`;
  });
}
