/**
 * The editable model behind both rule editors (Form and Ladder). Pure — no
 * React, no I/O — so the round trip to the API shape and every tree edit are
 * unit-tested (`rule-draft.test.ts`).
 *
 * A rule reads as WHEN → IF → THEN:
 *   - WHEN: what triggers it (a reading, a schedule, manually, a device
 *     connecting/disconnecting).
 *   - IF: a condition tree of contacts. AND = series, OR = parallel — the
 *     ladder draws exactly this tree, so it can never show a graph the engine
 *     can't run. Optional for everything except "on reading".
 *   - THEN: actions, all run in parallel.
 * plus, for reading rules only, a behaviour (re-arm / latch) and timing.
 */

import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type ConditionLeaf = components["schemas"]["ConditionLeaf"];
type ConditionGroup = components["schemas"]["ConditionGroup-Output"];
type ConditionNode = ConditionLeaf | ConditionGroup;
type RhsSpec = NonNullable<ConditionLeaf["rhs"]>;

export type TriggerType = "metric" | "schedule" | "manual" | "device_status";
export type Transition = "connected" | "disconnected";
export type Combinator = "AND" | "OR";
export type ValueKind = "boolean" | "number" | "text";
/** How many rhs values an operator takes, and of what shape. */
export type OperatorArity = "none" | "one" | "range" | "set";
export type RhsKind = "static" | "metric";
/** "other" = an API-authored strategy (continuous / reset_condition) the
 * editors don't offer — kept as-is on save. */
export type Behaviour = "rearm" | "latch" | "other";

export interface WhenDraft {
  type: TriggerType;
  cron: string;
  timezone: string;
  statusDeviceId: string;
  transition: Transition;
}

/** One condition leaf — a ladder contact. */
export interface ContactDraft {
  kind: "contact";
  id: string;
  deviceId: string;
  metric: string;
  operator: string;
  hysteresis: number;
  // rhs — only the fields matching the operator's arity/kind are read on
  // build; the rest sit inert so switching operators doesn't lose input.
  rhsKind: RhsKind;
  value: number;
  low: number;
  high: number;
  /** Comma-separated — parsed to number[] on build (in / not_in). */
  setText: string;
  rhsDeviceId: string;
  rhsMetric: string;
}

export interface GroupDraft {
  kind: "group";
  id: string;
  op: Combinator;
  children: DraftNode[];
}

export type DraftNode = ContactDraft | GroupDraft;

export interface ActuatorActionDraft {
  kind: "actuator";
  id: string;
  deviceId: string;
  actuator: string;
  valueKind: ValueKind;
  bool: boolean;
  num: number;
  text: string;
  /** Send a value back when the condition clears (reading + re-arm only). */
  revertOnClear: boolean;
  /** null = the opposite of `bool`, tracked live. */
  clearBool: boolean | null;
  clearNum: number;
  clearText: string;
}

export interface EmailActionDraft {
  kind: "email";
  id: string;
  /** Comma-separated; empty = the workspace alert recipients. */
  to: string;
  subject: string;
  body: string;
}

export interface WebhookActionDraft {
  kind: "webhook";
  id: string;
  url: string;
  /** JSON text — parsed on build. */
  body: string;
}

export interface NotificationActionDraft {
  kind: "notification";
  id: string;
  message: string;
}

export type ActionDraft =
  | ActuatorActionDraft
  | EmailActionDraft
  | WebhookActionDraft
  | NotificationActionDraft;
export type ActionKind = ActionDraft["kind"];

export interface RuleDraft {
  name: string;
  enabled: boolean;
  when: WhenDraft;
  condition: DraftNode | null;
  behaviour: Behaviour;
  forDuration: number;
  cooldown: number;
  clearDelay: number;
  actions: ActionDraft[];
  clearNotify: boolean;
  clearMessage: string;
  /** API-authored fields the editors don't expose, passed through on save. */
  preserved: {
    strategy: string | null;
    resetCondition: ConditionNode | null;
    clearActions: Record<string, unknown>[];
    /** Actions of an unknown type — kept in place order at the end. */
    actions: Record<string, unknown>[];
  };
}

export const OPERATORS: { value: string; label: string }[] = [
  { value: ">", label: "> above" },
  { value: ">=", label: "≥ at or above" },
  { value: "<", label: "< below" },
  { value: "<=", label: "≤ at or below" },
  { value: "==", label: "= equal to" },
  { value: "!=", label: "≠ different from" },
  { value: "between", label: "between" },
  { value: "not_between", label: "outside" },
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is none of" },
  { value: "changed", label: "changes" },
  { value: "increased", label: "increases" },
  { value: "decreased", label: "decreases" },
];

export const OPERATOR_SYMBOL: Record<string, string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "==": "=",
  "!=": "≠",
  between: "in",
  not_between: "outside",
  in: "∈",
  not_in: "∉",
  changed: "changes",
  increased: "rises",
  decreased: "falls",
};

export const OPERATOR_ARITY: Record<string, OperatorArity> = {
  ">": "one",
  ">=": "one",
  "<": "one",
  "<=": "one",
  "==": "one",
  "!=": "one",
  between: "range",
  not_between: "range",
  in: "set",
  not_in: "set",
  changed: "none",
  increased: "none",
  decreased: "none",
};

// Mirrors backend schemas._HYSTERESIS_OPERATORS — the API rejects hysteresis on any other operator.
export const HYSTERESIS_OPERATORS = new Set([">", ">=", "<", "<="]);

// Safe, non-zero starting points (a hardware-safety requirement).
export const DEFAULT_FOR_DURATION = 10;
export const DEFAULT_COOLDOWN = 60;
export const DEFAULT_HYSTERESIS = 1;

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  metric: "On reading",
  schedule: "On schedule",
  manual: "Manually",
  device_status: "Device connects / disconnects",
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  actuator: "Actuator",
  email: "Email",
  webhook: "Webhook",
  notification: "In-app notification",
};

let uidCounter = 0;
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  uidCounter += 1;
  return `id-${uidCounter}`;
}

/** Reading rules have the full model; event/manual rules fire per event. */
export function isReadingRule(draft: RuleDraft): boolean {
  return draft.when.type === "metric";
}

/** Whether "turn back when the condition clears" can apply at all. */
export function canClear(draft: RuleDraft): boolean {
  return isReadingRule(draft) && draft.behaviour === "rearm";
}

// ---- Constructors ------------------------------------------------------------

export function emptyContact(deviceId: string): ContactDraft {
  return {
    kind: "contact",
    id: newId(),
    deviceId,
    metric: "",
    operator: ">",
    hysteresis: DEFAULT_HYSTERESIS,
    rhsKind: "static",
    value: 0,
    low: 0,
    high: 0,
    setText: "",
    rhsDeviceId: "",
    rhsMetric: "",
  };
}

export function emptyAction(kind: ActionKind, deviceId: string): ActionDraft {
  const id = newId();
  switch (kind) {
    case "actuator":
      return {
        kind,
        id,
        deviceId,
        actuator: "",
        valueKind: "boolean",
        bool: true,
        num: 0,
        text: "",
        revertOnClear: false,
        clearBool: null,
        clearNum: 0,
        clearText: "",
      };
    case "email":
      return { kind, id, to: "", subject: "", body: "" };
    case "webhook":
      return { kind, id, url: "", body: "{}" };
    case "notification":
      return { kind, id, message: "" };
  }
}

export function emptyDraft(seedDevice = ""): RuleDraft {
  return {
    name: "",
    enabled: true,
    when: {
      type: "metric",
      cron: "0 8 * * *",
      timezone: "UTC",
      statusDeviceId: seedDevice,
      transition: "disconnected",
    },
    condition: emptyContact(seedDevice),
    behaviour: "rearm",
    forDuration: DEFAULT_FOR_DURATION,
    cooldown: DEFAULT_COOLDOWN,
    clearDelay: 0,
    actions: [emptyAction("actuator", seedDevice)],
    clearNotify: false,
    clearMessage: "",
    preserved: { strategy: null, resetCondition: null, clearActions: [], actions: [] },
  };
}

// ---- From the API ----------------------------------------------------------

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function contactFromLeaf(leaf: ConditionLeaf): ContactDraft {
  const base = {
    ...emptyContact(str((leaf as { device_id?: unknown }).device_id)),
    metric: leaf.metric,
    operator: leaf.operator,
    hysteresis: leaf.hysteresis ?? 0,
  };
  const rhs = leaf.rhs;
  if (rhs == null) return base;
  if (rhs.source === "range") return { ...base, low: rhs.low, high: rhs.high };
  if (rhs.source === "set") return { ...base, setText: rhs.values.join(", ") };
  if (rhs.source === "metric")
    return { ...base, rhsKind: "metric", rhsDeviceId: rhs.device_id, rhsMetric: rhs.metric };
  return { ...base, value: rhs.value };
}

export function nodeFromCondition(node: ConditionNode): DraftNode {
  if (node.kind === "leaf") return contactFromLeaf(node);
  return {
    kind: "group",
    id: newId(),
    op: node.op,
    children: (node.predicates as ConditionNode[]).map(nodeFromCondition),
  };
}

function valueKindOf(v: unknown): ValueKind {
  return typeof v === "number" ? "number" : typeof v === "string" ? "text" : "boolean";
}

function actionFromApi(a: Record<string, unknown>): ActionDraft | null {
  const id = newId();
  if (a.type === "actuator_command" && typeof a.actuator === "string") {
    const value = a.value;
    return {
      ...(emptyAction("actuator", str(a.device_id)) as ActuatorActionDraft),
      id,
      actuator: a.actuator,
      valueKind: valueKindOf(value),
      bool: value !== false,
      num: typeof value === "number" ? value : 0,
      text: typeof value === "string" ? value : "",
    };
  }
  if (a.type === "email") {
    const to = Array.isArray(a.to) ? (a.to as unknown[]).map(String) : [];
    return { kind: "email", id, to: to.join(", "), subject: str(a.subject), body: str(a.body) };
  }
  if (a.type === "webhook") {
    return {
      kind: "webhook",
      id,
      url: str(a.url),
      body: a.body ? JSON.stringify(a.body, null, 2) : "{}",
    };
  }
  if (a.type === "notification") {
    // The pre-Email-action "also email the alert list" channel becomes two
    // parallel actions: the in-app notification and an Email with no `to`.
    return { kind: "notification", id, message: str(a.message) };
  }
  return null;
}

export function draftFromRule(rule: RuleResponse): RuleDraft {
  const trigger = (rule.trigger ?? {}) as Record<string, unknown>;
  const type = str(trigger.type, "metric") as TriggerType;
  const policy = rule.execution_policy;
  const strategy = policy.strategy ?? "edge";

  const actions: ActionDraft[] = [];
  const preservedActions: Record<string, unknown>[] = [];
  for (const raw of rule.actions as Record<string, unknown>[]) {
    const parsed = actionFromApi(raw);
    if (parsed === null) {
      preservedActions.push(raw);
      continue;
    }
    actions.push(parsed);
    const channels = Array.isArray(raw.channels) ? (raw.channels as string[]) : [];
    if (parsed.kind === "notification" && channels.includes("email")) {
      actions.push({
        kind: "email",
        id: newId(),
        to: "",
        subject: `[${rule.name}] alert`,
        body: parsed.message,
      });
    }
  }

  // An actuator clear command that targets one of the actions' own
  // device/actuator folds into that action's "turn back on clear"; one
  // notification folds into clearNotify; anything else is passed through.
  const preservedClear: Record<string, unknown>[] = [];
  let clearNotify = false;
  let clearMessage = "";
  for (const raw of (rule.clear_actions ?? []) as Record<string, unknown>[]) {
    const owner =
      raw.type === "actuator_command"
        ? actions.find(
            (a): a is ActuatorActionDraft =>
              a.kind === "actuator" &&
              !a.revertOnClear &&
              a.actuator === raw.actuator &&
              a.deviceId === str(raw.device_id),
          )
        : undefined;
    if (owner) {
      owner.revertOnClear = true;
      const v = raw.value;
      if (typeof v === "boolean") owner.clearBool = v;
      if (typeof v === "number") owner.clearNum = v;
      if (typeof v === "string") owner.clearText = v;
      continue;
    }
    const clearChannels = Array.isArray(raw.channels) ? (raw.channels as string[]) : [];
    if (raw.type === "notification" && !clearNotify && !clearChannels.includes("email")) {
      clearNotify = true;
      clearMessage = str(raw.message);
      continue;
    }
    preservedClear.push(raw);
  }

  return {
    name: rule.name,
    enabled: rule.enabled,
    when: {
      type,
      cron: str(trigger.cron, "0 8 * * *"),
      timezone: str(trigger.timezone, "UTC"),
      statusDeviceId: str(trigger.device_id),
      transition: trigger.transition === "connected" ? "connected" : "disconnected",
    },
    condition: rule.condition ? nodeFromCondition(rule.condition as ConditionNode) : null,
    behaviour: strategy === "edge" ? "rearm" : strategy === "latch" ? "latch" : "other",
    forDuration: policy.for_duration ?? 0,
    cooldown: policy.cooldown ?? 0,
    clearDelay: policy.clear_for_duration ?? 0,
    actions,
    clearNotify,
    clearMessage,
    preserved: {
      strategy,
      resetCondition: (policy.reset_condition as ConditionNode | null | undefined) ?? null,
      clearActions: preservedClear,
      actions: preservedActions,
    },
  };
}

// ---- To the API ------------------------------------------------------------

function buildRhs(c: ContactDraft): RhsSpec | null {
  const arity = OPERATOR_ARITY[c.operator] ?? "one";
  if (arity === "none") return null;
  if (arity === "range") return { source: "range", low: c.low, high: c.high };
  if (arity === "set") {
    const values = c.setText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    return { source: "set", values };
  }
  if (c.rhsKind === "metric") return { source: "metric", device_id: c.rhsDeviceId, metric: c.rhsMetric };
  return { source: "static", value: c.value };
}

export function leafFromContact(c: ContactDraft): ConditionLeaf {
  return {
    kind: "leaf",
    device_id: c.deviceId,
    metric: c.metric,
    operator: c.operator,
    rhs: buildRhs(c),
    hysteresis: HYSTERESIS_OPERATORS.has(c.operator) ? c.hysteresis : 0,
  } as ConditionLeaf;
}

export function conditionFromNode(node: DraftNode | null): ConditionNode | null {
  const n = normalize(node);
  if (n === null) return null;
  if (n.kind === "contact") return leafFromContact(n);
  return {
    kind: "group",
    op: n.op,
    predicates: n.children.map((c) => conditionFromNode(c) as ConditionNode),
  } as ConditionGroup;
}

function actuatorValue(a: ActuatorActionDraft): boolean | number | string {
  return a.valueKind === "boolean" ? a.bool : a.valueKind === "number" ? a.num : a.text;
}

function actuatorClearValue(a: ActuatorActionDraft): boolean | number | string {
  if (a.valueKind === "boolean") return a.clearBool ?? !a.bool;
  return a.valueKind === "number" ? a.clearNum : a.clearText;
}

export function parseRecipients(to: string): string[] {
  return to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function actionToApi(a: ActionDraft): Record<string, unknown> {
  switch (a.kind) {
    case "actuator":
      return {
        type: "actuator_command",
        device_id: a.deviceId,
        actuator: a.actuator.trim(),
        value: actuatorValue(a),
      };
    case "email":
      return {
        type: "email",
        to: parseRecipients(a.to),
        subject: a.subject.trim(),
        body: a.body.trim(),
      };
    case "webhook":
      return { type: "webhook", url: a.url.trim(), body: JSON.parse(a.body.trim() || "{}") };
    case "notification":
      return { type: "notification", message: a.message.trim(), channels: ["platform"] };
  }
}

function strategyFor(draft: RuleDraft): string {
  if (!isReadingRule(draft)) return "edge";
  if (draft.behaviour === "latch") return "latch";
  if (draft.behaviour === "other") return draft.preserved.strategy ?? "edge";
  return "edge";
}

/** The canonical POST /rules | PATCH /rules/{id} body. Call `validateDraft`
 * first — this assumes every field it reads is already well-formed. */
export function draftToRequest(draft: RuleDraft): Record<string, unknown> {
  const reading = isReadingRule(draft);
  const clearing = canClear(draft);
  const w = draft.when;
  const trigger =
    w.type === "schedule"
      ? { type: "schedule", cron: w.cron.trim(), timezone: w.timezone.trim() || "UTC" }
      : w.type === "device_status"
        ? { type: "device_status", device_id: w.statusDeviceId, transition: w.transition }
        : { type: w.type };

  const clearActions: Record<string, unknown>[] = [];
  if (clearing) {
    for (const a of draft.actions) {
      if (a.kind === "actuator" && a.revertOnClear) {
        clearActions.push({ ...actionToApi(a), value: actuatorClearValue(a) });
      }
    }
    if (draft.clearNotify && draft.clearMessage.trim()) {
      clearActions.push({
        type: "notification",
        message: draft.clearMessage.trim(),
        channels: ["platform"],
      });
    }
    clearActions.push(...draft.preserved.clearActions);
  }

  const strategy = strategyFor(draft);
  const keepsResetTree = strategy === "latch" || strategy === "reset_condition";
  return {
    name: draft.name.trim() || undefined,
    trigger,
    condition: conditionFromNode(draft.condition),
    execution_policy: {
      strategy,
      // An event has no duration to hold across (the engine ignores it too).
      for_duration: reading ? draft.forDuration : 0,
      cooldown: draft.cooldown,
      clear_for_duration: clearing ? draft.clearDelay : 0,
      reset_condition: keepsResetTree ? draft.preserved.resetCondition : null,
    },
    actions: [...draft.actions.map(actionToApi), ...draft.preserved.actions],
    clear_actions: clearActions,
    enabled: draft.enabled,
  };
}

// ---- Validation --------------------------------------------------------------

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function contactProblem(c: ContactDraft): string | null {
  if (!c.deviceId || !c.metric.trim()) return "Every condition needs a device and a metric.";
  if (c.rhsKind === "metric" && OPERATOR_ARITY[c.operator] === "one" && (!c.rhsDeviceId || !c.rhsMetric))
    return "A device comparison needs both a device and a metric.";
  return null;
}

export function actionProblem(a: ActionDraft): string | null {
  switch (a.kind) {
    case "actuator":
      return a.deviceId && a.actuator.trim() ? null : "An actuator action needs a device and an actuator.";
    case "email": {
      const bad = parseRecipients(a.to).find((r) => !EMAIL_SHAPE.test(r));
      if (bad) return `"${bad}" doesn't look like an email address.`;
      return a.subject.trim() && a.body.trim() ? null : "An email needs a subject and a message.";
    }
    case "webhook":
      if (!a.url.trim()) return "A webhook needs a URL.";
      try {
        JSON.parse(a.body.trim() || "{}");
        return null;
      } catch {
        return "The webhook body isn't valid JSON.";
      }
    case "notification":
      return a.message.trim() ? null : "A notification needs a message.";
  }
}

export function validateDraft(draft: RuleDraft): string | null {
  const w = draft.when;
  if (w.type === "schedule" && !w.cron.trim()) return "A scheduled rule needs a cron expression.";
  if (w.type === "device_status" && !w.statusDeviceId) return "Pick the device to watch.";
  if (draft.condition === null && w.type === "metric")
    return "A rule that runs on each reading needs at least one condition.";
  for (const c of contacts(draft.condition)) {
    const problem = contactProblem(c);
    if (problem) return problem;
  }
  if (draft.actions.length === 0 && draft.preserved.actions.length === 0)
    return "Add at least one action.";
  for (const a of draft.actions) {
    const problem = actionProblem(a);
    if (problem) return problem;
  }
  if (canClear(draft) && draft.clearNotify && !draft.clearMessage.trim())
    return "The clear notification needs a message.";
  return null;
}

/** Actuator clears are never held back by cooldown, so an analog reading
 * dithering at a zero-hysteresis threshold would toggle the relay on every
 * reading — the editors warn about it. */
export function flappingRisk(draft: RuleDraft): boolean {
  return (
    canClear(draft) &&
    draft.clearDelay === 0 &&
    draft.actions.some((a) => a.kind === "actuator" && a.revertOnClear) &&
    contacts(draft.condition).some((c) => HYSTERESIS_OPERATORS.has(c.operator) && !(c.hysteresis > 0))
  );
}

// ---- Tree operations -----------------------------------------------------------
// Every op returns a new, normalized tree; ids are stable across edits.

export function contacts(node: DraftNode | null): ContactDraft[] {
  if (node === null) return [];
  return node.kind === "contact" ? [node] : node.children.flatMap(contacts);
}

export function findNode(node: DraftNode | null, id: string): DraftNode | null {
  if (node === null) return null;
  if (node.id === id) return node;
  if (node.kind === "group") {
    for (const child of node.children) {
      const hit = findNode(child, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Collapse single-child groups, drop empty ones, and merge a group into a
 * parent with the same operator — so series-in-series is one series. */
export function normalize(node: DraftNode | null): DraftNode | null {
  if (node === null || node.kind === "contact") return node;
  const children: DraftNode[] = [];
  for (const raw of node.children) {
    const child = normalize(raw);
    if (child === null) continue;
    if (child.kind === "group" && child.op === node.op) children.push(...child.children);
    else children.push(child);
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function mapNode(node: DraftNode, fn: (n: DraftNode) => DraftNode): DraftNode {
  const next = fn(node);
  if (next !== node || next.kind === "contact") return next;
  return { ...next, children: next.children.map((c) => mapNode(c, fn)) };
}

/** Put `added` next to `targetId`: AND = in series (after it), OR = in
 * parallel (below it). Joins the target's parent when it already combines
 * with `op`; otherwise wraps the target in a new group. A null tree just
 * becomes `added`. */
export function insertBeside(
  root: DraftNode | null,
  targetId: string,
  added: DraftNode,
  op: Combinator,
): DraftNode | null {
  if (root === null) return added;
  if (root.id === targetId) {
    return normalize({ kind: "group", id: newId(), op, children: [root, added] });
  }
  const parentOf = (node: DraftNode): GroupDraft | null => {
    if (node.kind === "contact") return null;
    if (node.children.some((c) => c.id === targetId)) return node;
    for (const c of node.children) {
      const hit = parentOf(c);
      if (hit) return hit;
    }
    return null;
  };
  const parent = parentOf(root);
  if (parent === null) return root;
  const next = mapNode(root, (n) => {
    if (n.id !== parent.id || n.kind !== "group") return n;
    const at = n.children.findIndex((c) => c.id === targetId);
    if (n.op === op) {
      const children = [...n.children];
      children.splice(at + 1, 0, added);
      return { ...n, children };
    }
    const target = n.children[at];
    const wrapped: GroupDraft = { kind: "group", id: newId(), op, children: [target, added] };
    return { ...n, children: n.children.map((c, i) => (i === at ? wrapped : c)) };
  });
  return normalize(next);
}

export function removeNode(root: DraftNode | null, id: string): DraftNode | null {
  if (root === null || root.id === id) return null;
  if (root.kind === "contact") return root;
  const prune = (node: DraftNode): DraftNode | null => {
    if (node.id === id) return null;
    if (node.kind === "contact") return node;
    return { ...node, children: node.children.map(prune).filter((c): c is DraftNode => c !== null) };
  };
  return normalize(prune(root));
}

export function updateContact(
  root: DraftNode | null,
  id: string,
  patch: Partial<Omit<ContactDraft, "kind" | "id">>,
): DraftNode | null {
  if (root === null) return null;
  return mapNode(root, (n) => (n.id === id && n.kind === "contact" ? { ...n, ...patch } : n));
}

/** Flip a group between AND (series) and OR (parallel). */
export function setGroupOp(root: DraftNode | null, id: string, op: Combinator): DraftNode | null {
  if (root === null) return null;
  return normalize(mapNode(root, (n) => (n.id === id && n.kind === "group" ? { ...n, op } : n)));
}
