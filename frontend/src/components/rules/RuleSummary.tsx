import { Fragment } from "react";
import { cn } from "@/lib/cn";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type ActuatorCommandAction = components["schemas"]["ActuatorCommandAction"];
type NotificationAction = components["schemas"]["NotificationAction"];
type WebhookAction = components["schemas"]["WebhookAction"];
export type RuleAction = ActuatorCommandAction | NotificationAction | WebhookAction;

export type ConditionLeaf = components["schemas"]["ConditionLeaf"];
export type ConditionGroup = components["schemas"]["ConditionGroup-Output"];
export type ConditionNode = ConditionLeaf | ConditionGroup;
export type RhsSpec = NonNullable<ConditionLeaf["rhs"]>;

/** What the summary needs — a full RuleResponse satisfies this structurally,
 * but RuleForm's live preview (no id/device_id/created_at yet) can too.
 * `trigger` is needed to render a condition-less device_status rule's
 * sentence (the only case `condition` is null). */
export type RuleSummaryData = Pick<RuleResponse, "condition" | "for_duration" | "action" | "trigger">;

const OPERATOR_WORDS: Record<string, string> = {
  ">": "goes above",
  ">=": "reaches or exceeds",
  "<": "drops below",
  "<=": "falls to or below",
  "==": "equals",
  "!=": "is different from",
  between: "goes between",
  not_between: "goes outside",
  in: "is one of",
  not_in: "is none of",
  changed: "changes",
  increased: "increases",
  decreased: "decreases",
};

const CHANGE_OPERATORS = new Set(["changed", "increased", "decreased"]);

/** RuleResponse.action is an untyped dict at the API-contract level (the
 * backend stores it as JSONB and only request bodies carry the discriminated
 * union) — this is the one place that shape gets trusted back into a union,
 * since every write path validated it with that same union first. */
export function parseAction(action: RuleSummaryData["action"]): RuleAction | null {
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
    return {
      type: "webhook",
      url: action.url,
      body: (action.body as Record<string, unknown>) ?? {},
    };
  }
  return null;
}

/** Every leaf predicate in a condition tree, flattened — for callers that
 * need to iterate every metric a rule references regardless of tree shape
 * (e.g. per-metric chart threshold markers, search-by-metric filtering).
 * `null` (a condition-less device_status rule) has no leaves. */
export function leafPredicates(node: ConditionNode | null): ConditionLeaf[] {
  if (node == null) return [];
  return node.kind === "leaf" ? [node] : node.predicates.flatMap(leafPredicates);
}

/** A bolded value in the sentence — rendered as an accent "unfilled" chip
 * instead when it equals the caller's placeholder marker (the live preview in
 * RuleForm passes `placeholder="…"`; the list call sites pass nothing, so this
 * is always a plain `<strong>` there). */
function Value({ children, placeholder }: { children: string | number; placeholder?: string }) {
  if (placeholder != null && String(children) === placeholder) {
    return <span className="rounded bg-accent-muted px-1.5 font-medium text-accent">{children}</span>;
  }
  return <strong>{children}</strong>;
}

/** The right-hand-side clause after the operator word — changed/increased/
 * decreased have none (they compare a signal to its own previous reading). */
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
        <Value placeholder={placeholder}>{rhs.low}</Value> and{" "}
        <Value placeholder={placeholder}>{rhs.high}</Value>
      </>
    );
  if (rhs.source === "set")
    return <Value placeholder={placeholder}>{rhs.values.join(", ")}</Value>;
  // "metric" — another device's live reading instead of a static number.
  const name = deviceNameById?.[rhs.device_id] ?? rhs.device_id;
  return <Value placeholder={placeholder}>{`${name} ${rhs.metric}`}</Value>;
}

function ConditionText({
  node,
  placeholder,
  deviceNameById,
}: {
  node: ConditionNode;
  placeholder?: string;
  deviceNameById?: Record<string, string>;
}) {
  if (node.kind === "leaf") {
    const op = OPERATOR_WORDS[node.operator] ?? node.operator;
    return (
      <>
        <Value placeholder={placeholder}>{node.metric}</Value> {op}
        {!CHANGE_OPERATORS.has(node.operator) && (
          <>
            {" "}
            <RhsText rhs={node.rhs} placeholder={placeholder} deviceNameById={deviceNameById} />
          </>
        )}
      </>
    );
  }
  const joiner = node.op === "AND" ? " and " : " or ";
  return (
    <>
      {node.predicates.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && joiner}
          <ConditionText node={child} placeholder={placeholder} deviceNameById={deviceNameById} />
        </Fragment>
      ))}
    </>
  );
}

/** A condition-less device_status rule's "When ..." clause — the trigger
 * itself is the condition, so there's no ConditionText to render. */
function DeviceStatusText({
  trigger,
  placeholder,
  deviceNameById,
}: {
  trigger: Record<string, unknown>;
  placeholder?: string;
  deviceNameById?: Record<string, string>;
}) {
  const deviceId = typeof trigger.device_id === "string" ? trigger.device_id : "";
  const name = (deviceId && deviceNameById?.[deviceId]) || deviceId || "a device";
  const verb = trigger.transition === "connected" ? "connects" : "disconnects";
  return (
    <>
      <Value placeholder={placeholder}>{name}</Value> {verb}
    </>
  );
}

/** The at-a-glance sentence UX_UI_Description.md §6 requires every rule to
 * render as — bolded values so it can be verified without reading closely. */
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
  /** Resolves a device_id to its display name for a device_status trigger's
   * sentence and for a metric-vs-metric leaf's rhs. Falls back to the raw id
   * when omitted or the id isn't in the map. */
  deviceNameById?: Record<string, string>;
}) {
  const action = parseAction(rule.action);
  const trigger = (rule.trigger ?? {}) as Record<string, unknown>;

  return (
    <p className={cn("text-sm text-ink", className)}>
      When{" "}
      {rule.condition ? (
        <ConditionText node={rule.condition} placeholder={placeholder} deviceNameById={deviceNameById} />
      ) : (
        <DeviceStatusText trigger={trigger} placeholder={placeholder} deviceNameById={deviceNameById} />
      )}
      {rule.for_duration > 0 && (
        <>
          {" "}
          for <strong>{rule.for_duration}s</strong>
        </>
      )}
      ,{" "}
      {action?.type === "actuator_command" ? (
        <>
          turn <Value placeholder={placeholder}>{action.actuator}</Value>{" "}
          <Value placeholder={placeholder}>
            {typeof action.value === "boolean" ? (action.value ? "ON" : "OFF") : String(action.value)}
          </Value>
        </>
      ) : action?.type === "notification" ? (
        <>
          send a notification: &ldquo;<Value placeholder={placeholder}>{action.message}</Value>&rdquo;
        </>
      ) : action?.type === "webhook" ? (
        <>
          call the webhook at <Value placeholder={placeholder}>{action.url}</Value>
        </>
      ) : (
        "do nothing (unrecognized action)"
      )}
      .
    </p>
  );
}
