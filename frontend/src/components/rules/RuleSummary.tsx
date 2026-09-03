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

/** What the summary needs — a full RuleResponse satisfies this structurally,
 * but RuleForm's live preview (no id/device_id/created_at yet) can too. */
export type RuleSummaryData = Pick<RuleResponse, "condition" | "for_duration" | "action">;

const OPERATOR_WORDS: Record<string, string> = {
  ">": "goes above",
  ">=": "reaches or exceeds",
  "<": "drops below",
  "<=": "falls to or below",
  "==": "equals",
  "!=": "is different from",
};

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
 * (e.g. per-metric chart threshold markers, search-by-metric filtering). */
export function leafPredicates(node: ConditionNode): ConditionLeaf[] {
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

function ConditionText({ node, placeholder }: { node: ConditionNode; placeholder?: string }) {
  if (node.kind === "leaf") {
    const op = OPERATOR_WORDS[node.operator] ?? node.operator;
    return (
      <>
        <Value placeholder={placeholder}>{node.metric}</Value> {op}{" "}
        <Value placeholder={placeholder}>{node.threshold}</Value>
      </>
    );
  }
  const joiner = node.op === "AND" ? " and " : " or ";
  return (
    <>
      {node.predicates.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && joiner}
          <ConditionText node={child} placeholder={placeholder} />
        </Fragment>
      ))}
    </>
  );
}

/** The at-a-glance sentence UX_UI_Description.md §6 requires every rule to
 * render as — bolded values so it can be verified without reading closely. */
export function RuleSummary({
  rule,
  placeholder,
  className,
}: {
  rule: RuleSummaryData;
  /** Values equal to this render as an "unfilled" accent chip (the live
   * preview passes "…"). */
  placeholder?: string;
  className?: string;
}) {
  const action = parseAction(rule.action);

  return (
    <p className={cn("text-sm text-ink", className)}>
      When <ConditionText node={rule.condition} placeholder={placeholder} />
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
