/**
 * The rule workbench's preview logic (DESIGN.md §9.4), pure so it's tested:
 * the safety checks shown while typing, and the exact messages a draft
 * would send.
 */
import { tActive as t } from "@iodriven/shared/i18n";
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
  /** A failing blocking check stops the save (red ✕); a safety check is a
   * warning that never blocks it (amber "!", like the section rail). */
  blocking: boolean;
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
      ? t("editor.rules.readingNeeds")
      : (leafs.map(contactProblem).find(Boolean) ?? null);
  const actionsProblem =
    d.actions.length === 0 && d.preserved.actions.length === 0 ? t("editor.rules.addAction") : (d.actions.map(actionProblem).find(Boolean) ?? null);
  const checks: Check[] = [
    { id: "conditions", label: t("editor.rules.conditionsComplete"), ok: !conditionProblem, blocking: true, detail: conditionProblem ?? undefined },
    { id: "actions", label: t("editor.rules.actionsComplete"), ok: !actionsProblem, blocking: true, detail: actionsProblem ?? undefined },
  ];
  if (reading) {
    checks.push({
      id: "hold",
      label: t("editor.rules.holdAtLeast", { n: MIN_HOLD }),
      ok: d.forDuration >= MIN_HOLD,
      blocking: false,
      detail: d.forDuration >= MIN_HOLD ? undefined : t("editor.rules.holdDetail"),
    });
  }
  checks.push({
    id: "interval",
    label: t("editor.rules.intervalAtLeast", { n: MIN_INTERVAL }),
    ok: d.cooldown >= MIN_INTERVAL,
    blocking: false,
    detail: d.cooldown >= MIN_INTERVAL ? undefined : t("editor.rules.intervalDetail"),
  });
  if (reading && switchesHardware(d)) {
    const bare = leafs.filter((c) => HYSTERESIS_OPERATORS.has(c.operator) && !(c.hysteresis > 0));
    checks.push({
      id: "hysteresis",
      label: t("editor.rules.hysteresisAbove"),
      ok: bare.length === 0,
      blocking: false,
      detail: bare.length === 0 ? undefined : t("editor.rules.hysteresisDetail"),
    });
  }
  return checks;
}

/** The editor's sections, in rail order (DESIGN.md §9.2). */
export type RuleSection = "when" | "if" | "then" | "behaviour" | "name";
export const RULE_SECTIONS: { id: RuleSection; label: string; sub: string }[] = [
  { id: "when", get label() { return t("editor.rules.sections.when"); }, get sub() { return t("editor.rules.sections.whenSub"); } },
  { id: "if", get label() { return t("editor.rules.sections.if"); }, get sub() { return t("editor.rules.sections.ifSub"); } },
  { id: "then", get label() { return t("editor.rules.sections.then"); }, get sub() { return t("editor.rules.sections.thenSub"); } },
  { id: "behaviour", get label() { return t("editor.rules.sections.behaviour"); }, get sub() { return t("editor.rules.sections.behaviourSub"); } },
  { id: "name", get label() { return t("editor.rules.sections.name"); }, get sub() { return t("editor.rules.sections.nameSub"); } },
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

  if (w.type === "schedule" && !w.cron.trim()) add("when", t("editor.rules.issueCron"), true);
  if (w.type === "device_status" && !w.statusDeviceId) add("when", t("editor.rules.issueStatusDevice"), true);

  if (reading && d.condition === null) add("if", t("editor.rules.readingNeeds"), true);
  for (const c of leafs) {
    const p = contactProblem(c);
    if (p) add("if", p, true);
  }
  if (reading && switchesHardware(d) && leafs.some((c) => HYSTERESIS_OPERATORS.has(c.operator) && !(c.hysteresis > 0)))
    add("if", t("editor.rules.issueHysteresis"), false);

  if (d.actions.length === 0 && d.preserved.actions.length === 0) add("then", t("editor.rules.addAction"), true);
  for (const a of d.actions) {
    const p = actionProblem(a);
    if (p) add("then", p, true);
  }

  if (reading && d.forDuration < MIN_HOLD) add("behaviour", t("editor.rules.issueHold", { n: MIN_HOLD }), false);
  if (d.cooldown < MIN_INTERVAL) add("behaviour", t("editor.rules.issueInterval", { n: MIN_INTERVAL }), false);
  if (canClear(d) && d.clearNotify && !d.clearMessage.trim()) add("behaviour", t("editor.rules.issueClearMessage"), true);

  if (d.name.trim().length > MAX_NAME) add("name", t("editor.rules.issueName", { n: MAX_NAME }), true);
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
      const to = Array.isArray(a.to) && a.to.length ? (a.to as string[]).join(", ") : t("editor.rules.alertRecipients");
      out.push({ kind: "email", target: to, payload: String(a.subject ?? "") });
    } else if (a.type === "webhook") out.push({ kind: "webhook", target: String(a.url ?? ""), payload: JSON.stringify(a.body ?? {}) });
    else if (a.type === "notification") out.push({ kind: "notification", target: t("editor.rules.sendNotifications"), payload: String(a.message ?? "") });
  }
  for (const a of body.clear_actions as Record<string, unknown>[]) {
    if (a.type === "actuator_command") command(a, "clear");
    else if (a.type === "notification") out.push({ kind: "notification", target: t("editor.rules.sendNotificationsClear"), payload: String(a.message ?? "") });
  }
  return out;
}

export { parseRecipients };
