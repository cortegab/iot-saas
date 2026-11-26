import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { cronHuman } from "@/lib/schedule";
import { tzCity } from "@/lib/timezones";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import type { components } from "@/types/api";
import { tActive as tr, type MessageKey } from "@iodriven/shared/i18n";

type ActuatorCommandAction = components["schemas"]["ActuatorCommandAction"];
type NotificationAction = components["schemas"]["NotificationAction"];
type WebhookAction = components["schemas"]["WebhookAction"];
type EmailAction = components["schemas"]["EmailAction"];
export type RuleAction = ActuatorCommandAction | NotificationAction | WebhookAction | EmailAction;

export type ConditionLeaf = components["schemas"]["ConditionLeaf"];
export type ConditionGroup = components["schemas"]["ConditionGroup-Output"];
export type ConditionNode = ConditionLeaf | ConditionGroup;
export type RhsSpec = NonNullable<ConditionLeaf["rhs"]>;

/** What the sentence needs — the rule editors pass their request body
 * (`draftToRequest`), whose fields have the same shapes as a RuleResponse. */
export interface RuleSummaryData {
  trigger: Record<string, unknown>;
  condition: ConditionNode | null;
  actions: Record<string, unknown>[];
  clear_actions?: Record<string, unknown>[];
  execution_policy: { strategy?: string; for_duration?: number; clear_for_duration?: number };
}

/** The word for the direction a latched inequality releases in — the
 * complement of its own operator (a `>` rule releases at `<=`). */
const RELEASE_WORDS: Record<string, string> = {
  get ">"() { return tr("notif.ops.lte"); },
  get ">="() { return tr("notif.ops.lt"); },
  get "<"() { return tr("notif.ops.gte"); },
  get "<="() { return tr("notif.ops.gt"); },
};

/** Where a single-inequality rule's condition actually clears: the threshold
 * moved back by the hysteresis margin (mirrors evaluators._rearm_condition_met).
 * Null when there's no single static-threshold inequality to point at. */
export function releasePoint(
  condition: ConditionNode | null,
): { metric: string; words: string; value: number } | null {
  if (condition?.kind !== "leaf" || condition.rhs?.source !== "static") return null;
  const words = RELEASE_WORDS[condition.operator];
  if (!words) return null;
  const hysteresis = condition.hysteresis ?? 0;
  const below = condition.operator === ">" || condition.operator === ">=";
  const value = below ? condition.rhs.value - hysteresis : condition.rhs.value + hysteresis;
  return { metric: condition.metric, words, value: Number(value.toFixed(6)) };
}

/** Action dicts are untyped JSONB at the API-contract level (only request
 * bodies carry the discriminated union) — this is where that shape gets
 * trusted back into a union, since every write path validated it first. */
export function parseAction(action: Record<string, unknown>): RuleAction | null {
  if (action.type === "actuator_command" && typeof action.actuator === "string") {
    return {
      type: "actuator_command",
      actuator: action.actuator,
      value: action.value as boolean | number | string,
    };
  }
  if (action.type === "notification" && typeof action.message === "string") {
    return { type: "notification", message: action.message };
  }
  if (action.type === "webhook" && typeof action.url === "string") {
    return { type: "webhook", url: action.url, body: (action.body as Record<string, unknown>) ?? {} };
  }
  if (action.type === "email" && typeof action.subject === "string") {
    const to = Array.isArray(action.to) ? (action.to as unknown[]).map(String) : [];
    return { type: "email", to, subject: action.subject, body: String(action.body ?? "") };
  }
  return null;
}

/** Every leaf predicate in a condition tree, flattened — for callers that
 * need to iterate every metric a rule references regardless of tree shape
 * (e.g. per-metric chart threshold markers, search-by-metric filtering).
 * `null` (a condition-less rule) has no leaves. */
export function leafPredicates(node: ConditionNode | null): ConditionLeaf[] {
  if (node == null) return [];
  return node.kind === "leaf" ? [node] : node.predicates.flatMap(leafPredicates);
}

/** A bolded value in the sentence — rendered as an accent "unfilled" chip
 * instead when it equals the caller's placeholder marker. */
function Value({ children, placeholder }: { children: string | number; placeholder?: string }) {
  if (placeholder != null && String(children) === placeholder) {
    return <span className="rounded bg-accent-muted px-1.5 font-medium text-accent">{children}</span>;
  }
  return <strong>{children}</strong>;
}

function ActionText({ action, placeholder }: { action: RuleAction | null; placeholder?: string }) {
  if (action?.type === "actuator_command") {
    return (
      <>
        {tr("editor.sum.turnPre")}
        <Value placeholder={placeholder}>{action.actuator || (placeholder ?? "")}</Value>
        {tr("editor.sum.turnMid")}
        <Value placeholder={placeholder}>
          {typeof action.value === "boolean" ? (action.value ? "ON" : "OFF") : String(action.value)}
        </Value>
      </>
    );
  }
  if (action?.type === "notification") {
    return (
      <>
        {tr("editor.sum.notify")}&ldquo;<Value placeholder={placeholder}>{action.message || (placeholder ?? "")}</Value>&rdquo;
      </>
    );
  }
  if (action?.type === "webhook") {
    return (
      <>
        {tr("editor.sum.webhook")}
        <Value placeholder={placeholder}>{action.url || (placeholder ?? "")}</Value>
      </>
    );
  }
  if (action?.type === "email") {
    const to = action.to ?? [];
    return (
      <>
        {tr("editor.sum.email")}
        <Value placeholder={placeholder}>{to.length ? to.join(", ") : tr("editor.sum.alertRecipients")}</Value>
      </>
    );
  }
  return <>{tr("editor.sum.unrecognized")}</>;
}

function ActionList({ actions, placeholder }: { actions: Record<string, unknown>[]; placeholder?: string }) {
  if (actions.length === 0) return <Value placeholder={placeholder}>{placeholder ?? tr("editor.sum.nothing")}</Value>;
  return (
    <>
      {actions.map((a, i) => (
        <Fragment key={i}>
          {i > 0 && (i === actions.length - 1 ? tr("editor.sum.and") : ", ")}
          <ActionText action={parseAction(a)} placeholder={placeholder} />
        </Fragment>
      ))}
    </>
  );
}

const OPERATOR_KEYS: Record<string, string> = {
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
/** The operator as the sentence says it, in the language on screen. */
const OPERATOR_WORDS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, op: string) => (OPERATOR_KEYS[op] ? tr(`notif.ops.${OPERATOR_KEYS[op]}` as MessageKey) : undefined),
});

const CHANGE_OPERATORS = new Set(["changed", "increased", "decreased"]);

function RhsText({
  rhs,
  placeholder,
  deviceNameById,
}: {
  rhs: RhsSpec | null | undefined;
  placeholder?: string;
  deviceNameById?: Record<string, string>;
}) {
  if (rhs == null) return null;
  if (rhs.source === "static") return <Value placeholder={placeholder}>{rhs.value}</Value>;
  if (rhs.source === "range")
    return (
      <>
        <Value placeholder={placeholder}>{rhs.low}</Value>
        {tr("editor.sum.rangeAnd")}
        <Value placeholder={placeholder}>{rhs.high}</Value>
      </>
    );
  if (rhs.source === "set") return <Value placeholder={placeholder}>{rhs.values.join(", ")}</Value>;
  const name = deviceNameById?.[rhs.device_id] ?? rhs.device_id;
  return <Value placeholder={placeholder}>{`${name} ${rhs.metric}`}</Value>;
}

function ConditionText({
  node,
  placeholder,
  deviceNameById,
  nested = false,
}: {
  node: ConditionNode;
  placeholder?: string;
  deviceNameById?: Record<string, string>;
  nested?: boolean;
}) {
  if (node.kind === "leaf") {
    const op = OPERATOR_WORDS[node.operator] ?? node.operator;
    return (
      <>
        <Value placeholder={placeholder}>{node.metric || (placeholder ?? "")}</Value> {op}
        {!CHANGE_OPERATORS.has(node.operator) && (
          <>
            {" "}
            <RhsText rhs={node.rhs} placeholder={placeholder} deviceNameById={deviceNameById} />
          </>
        )}
      </>
    );
  }
  const joiner = tr(node.op === "AND" ? "editor.sum.and" : "editor.sum.or");
  // Parenthesise a nested group so "a and (b or c)" can't read as "(a and b) or c".
  return (
    <>
      {nested && "("}
      {node.predicates.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && joiner}
          <ConditionText node={child} placeholder={placeholder} deviceNameById={deviceNameById} nested />
        </Fragment>
      ))}
      {nested && ")"}
    </>
  );
}

function TriggerText({
  trigger,
  placeholder,
  deviceNameById,
}: {
  trigger: Record<string, unknown>;
  placeholder?: string;
  deviceNameById?: Record<string, string>;
}) {
  if (trigger.type === "schedule") {
    const zone = typeof trigger.timezone === "string" ? trigger.timezone : "UTC";
    // DESIGN.md §9.5: one plain wording for schedules everywhere.
    return (
      <>
        <Value placeholder={placeholder}>{capitalize(cronHuman(String(trigger.cron ?? "")))}</Value> (
        {tzCity(zone)})
      </>
    );
  }
  if (trigger.type === "manual") return <>{tr("editor.sum.manual")}</>;
  if (trigger.type === "device_status") {
    const deviceId = typeof trigger.device_id === "string" ? trigger.device_id : "";
    const name = (deviceId && deviceNameById?.[deviceId]) || placeholder || tr("editor.sum.aDevice");
    const verb = tr(trigger.transition === "connected" ? "editor.sum.connects" : "editor.sum.disconnects");
    return (
      <>
        {tr("editor.sum.statusWhen")}
        <Value placeholder={placeholder}>{name}</Value>
        {verb}
      </>
    );
  }
  return null;
}

function ClearText({ rule, placeholder }: { rule: RuleSummaryData; placeholder?: string }) {
  const actions = rule.clear_actions ?? [];
  if (actions.length === 0) return null;
  const release = releasePoint(rule.condition);
  const delay = rule.execution_policy.clear_for_duration ?? 0;
  return (
    <>
      {tr("editor.sum.clearWhen")}
      {release ? (
        <>
          <Value placeholder={placeholder}>{release.metric}</Value> {release.words}{" "}
          <Value placeholder={placeholder}>{release.value}</Value>
        </>
      ) : (
        tr("editor.sum.noLonger")
      )}
      {delay > 0 && (
        <>
          {tr("editor.sum.for")}
          <strong>{delay}s</strong>
        </>
      )}
      , <ActionList actions={actions} placeholder={placeholder} />
    </>
  );
}

/** The at-a-glance sentence every rule renders as — WHEN, IF, THEN — with
 * bolded values so it can be verified without reading closely. */
export function RuleSummary({
  rule,
  placeholder,
  className,
  deviceNameById,
}: {
  rule: RuleSummaryData;
  /** Values equal to this render as an "unfilled" accent chip (the live
   * preview passes "…"). */
  placeholder?: string;
  className?: string;
  /** Resolves a device_id to its display name (device-status trigger, a
   * metric-vs-metric comparison). Falls back to the raw id. */
  deviceNameById?: Record<string, string>;
}) {
  const reading = (rule.trigger.type ?? "metric") === "metric";
  const hold = reading ? (rule.execution_policy.for_duration ?? 0) : 0;
  const latch = reading && rule.execution_policy.strategy === "latch";
  const condition = rule.condition ? (
    <ConditionText node={rule.condition} placeholder={placeholder} deviceNameById={deviceNameById} />
  ) : null;

  return (
    <p className={cn("text-sm text-ink", className)}>
      {reading ? (
        <>
          {tr("editor.sum.when")}
          {condition ?? <Value placeholder={placeholder}>{placeholder ?? "…"}</Value>}
        </>
      ) : (
        <>
          <TriggerText trigger={rule.trigger} placeholder={placeholder} deviceNameById={deviceNameById} />
          {condition && (
            <>
              {tr("editor.sum.if")}
              {condition}
            </>
          )}
        </>
      )}
      {hold > 0 && (
        <>
          {tr("editor.sum.for")}
          <strong>{hold}s</strong>
        </>
      )}
      , <ActionList actions={rule.actions} placeholder={placeholder} />
      {latch && <>{tr("editor.sum.latch")}</>}
      <ClearText rule={rule} placeholder={placeholder} />.
    </p>
  );
}
