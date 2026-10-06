/**
 * The rule workbench's preview logic (DESIGN.md §9.4), pure so it's tested:
 * the safety checks shown while typing, and the exact messages a draft
 * would send.
 */
import {
  actionProblem,
  canClear,
  contactProblem,
  contacts,
  draftToRequest,
  HYSTERESIS_OPERATORS,
  isReadingRule,
  parseRecipients,
  type RuleDraft,
} from "@/lib/rule-draft";

export interface Check {
  id: "conditions" | "actions" | "hold" | "interval" | "hysteresis";
  label: string;
  ok: boolean;
  /** Why it failed, in the editor's words. */
  detail?: string;
}

/** Minimums the checks hold hardware rules to (CLAUDE.md §9.7). */
export const MIN_HOLD = 5;
export const MIN_INTERVAL = 30;

export const switchesHardware = (d: RuleDraft) => d.actions.some((a) => a.kind === "actuator");

export function ruleChecks(d: RuleDraft): Check[] {
  const reading = isReadingRule(d);
  const leafs = contacts(d.condition);
  const conditionProblem =
    reading && d.condition === null
      ? "A rule that runs on each reading needs at least one condition."
      : (leafs.map(contactProblem).find(Boolean) ?? null);
  const actionsProblem =
    d.actions.length === 0 && d.preserved.actions.length === 0 ? "Add at least one action." : (d.actions.map(actionProblem).find(Boolean) ?? null);
  const checks: Check[] = [
    { id: "conditions", label: "Conditions complete", ok: !conditionProblem, detail: conditionProblem ?? undefined },
    { id: "actions", label: "Actions complete", ok: !actionsProblem, detail: actionsProblem ?? undefined },
  ];
  if (reading) {
    checks.push({
      id: "hold",
      label: `Hold for at least ${MIN_HOLD} s`,
      ok: d.forDuration >= MIN_HOLD,
      detail: d.forDuration >= MIN_HOLD ? undefined : "A single noisy reading could fire it. Hold the condition for a few seconds first.",
    });
  }
  checks.push({
    id: "interval",
    label: `Minimum interval of at least ${MIN_INTERVAL} s`,
    ok: d.cooldown >= MIN_INTERVAL,
    detail: d.cooldown >= MIN_INTERVAL ? undefined : "It could fire again within seconds of the last time.",
  });
  if (reading && switchesHardware(d)) {
    const bare = leafs.filter((c) => HYSTERESIS_OPERATORS.has(c.operator) && !(c.hysteresis > 0));
    checks.push({
      id: "hysteresis",
      label: "Hysteresis above 0 on thresholds",
      ok: bare.length === 0,
      detail: bare.length === 0 ? undefined : "A reading hovering at the threshold would toggle the relay. Add a margin it must clear first.",
    });
  }
  return checks;
}

/** The editor's sections, in rail order (DESIGN.md §9.2). */
export type RuleSection = "when" | "if" | "then" | "behaviour" | "name";
export const RULE_SECTIONS: { id: RuleSection; label: string; sub: string }[] = [
  { id: "when", label: "When", sub: "Trigger" },
  { id: "if", label: "If", sub: "Conditions" },
  { id: "then", label: "Then", sub: "Actions" },
  { id: "behaviour", label: "Behaviour", sub: "Hold, interval, clear" },
  { id: "name", label: "Name", sub: "Name and status" },
];

export interface SectionIssue {
  section: RuleSection;
  message: string;
  /** Blocking issues stop a save; the rest are safety warnings shown while typing. */
  blocking: boolean;
}

export const MAX_NAME = 200;

/** Every problem with a draft, placed in the section that fixes it — the
 * rail's badges, "N to fix" and the save gate all read this one list. */
export function sectionIssues(d: RuleDraft): SectionIssue[] {
  const out: SectionIssue[] = [];
  const add = (section: RuleSection, message: string, blocking: boolean) => out.push({ section, message, blocking });
  const w = d.when;
  const reading = isReadingRule(d);
  const leafs = contacts(d.condition);

  if (w.type === "schedule" && !w.cron.trim()) add("when", "Pick when it runs.", true);
  if (w.type === "device_status" && !w.statusDeviceId) add("when", "Pick the device to watch.", true);

  if (reading && d.condition === null) add("if", "A rule that runs on each reading needs at least one condition.", true);
  for (const c of leafs) {
    const p = contactProblem(c);
    if (p) add("if", p, true);
  }
  if (reading && switchesHardware(d) && leafs.some((c) => HYSTERESIS_OPERATORS.has(c.operator) && !(c.hysteresis > 0)))
    add("if", "Add hysteresis to the thresholds so a reading hovering at the line doesn't toggle the relay.", false);

  if (d.actions.length === 0 && d.preserved.actions.length === 0) add("then", "Add at least one action.", true);
  for (const a of d.actions) {
    const p = actionProblem(a);
    if (p) add("then", p, true);
  }

  if (reading && d.forDuration < MIN_HOLD) add("behaviour", `Hold for at least ${MIN_HOLD} s so one noisy reading can't fire it.`, false);
  if (d.cooldown < MIN_INTERVAL) add("behaviour", `Keep at least ${MIN_INTERVAL} s between firings.`, false);
  if (canClear(d) && d.clearNotify && !d.clearMessage.trim()) add("behaviour", "The clear notification needs a message.", true);

  if (d.name.trim().length > MAX_NAME) add("name", `Keep the name to ${MAX_NAME} characters.`, true);
  return out;
}

export interface Send {
  kind: "command" | "clear" | "email" | "webhook" | "notification";
  /** Where it goes: an MQTT topic, recipients, or a URL. */
  target: string;
  /** What is sent. */
  payload: string;
}

/** The exact messages: `{tenant}/{device}/cmd/{actuator}` with
 * `{ value, ttl }` (CLAUDE.md §4), revert commands, emails and webhooks. */
export function wouldSend(
  d: RuleDraft,
  tenantSlug: string,
  deviceSlug: (id: string) => string | undefined,
  ttl = 30,
): Send[] {
  let body: Record<string, unknown>;
  try {
    body = draftToRequest(d);
  } catch {
    return [];
  }
  const out: Send[] = [];
  const command = (a: Record<string, unknown>, kind: "command" | "clear") => {
    const slug = deviceSlug(String(a.device_id ?? "")) ?? "?";
    out.push({
      kind,
      target: `${tenantSlug}/${slug}/cmd/${String(a.actuator ?? "?")}`,
      payload: JSON.stringify({ value: a.value, ttl }),
    });
  };
  for (const a of body.actions as Record<string, unknown>[]) {
    if (a.type === "actuator_command") command(a, "command");
    else if (a.type === "email") {
      const to = Array.isArray(a.to) && a.to.length ? (a.to as string[]).join(", ") : "the workspace's alert recipients";
      out.push({ kind: "email", target: to, payload: String(a.subject ?? "") });
    } else if (a.type === "webhook") out.push({ kind: "webhook", target: String(a.url ?? ""), payload: JSON.stringify(a.body ?? {}) });
    else if (a.type === "notification") out.push({ kind: "notification", target: "Notifications", payload: String(a.message ?? "") });
  }
  for (const a of body.clear_actions as Record<string, unknown>[]) {
    if (a.type === "actuator_command") command(a, "clear");
    else if (a.type === "notification") out.push({ kind: "notification", target: "Notifications (on clear)", payload: String(a.message ?? "") });
  }
  return out;
}

export { parseRecipients };
