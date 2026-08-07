import { Fragment } from "react";
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

function actionClause(action: RuleAction | null): string {
  if (action === null) return "do nothing (unrecognized action)";
  switch (action.type) {
    case "actuator_command": {
      const value =
        typeof action.value === "boolean" ? (action.value ? "ON" : "OFF") : String(action.value);
      return `turn ${action.actuator} ${value}`;
    }
    case "notification":
      return `send a notification: "${action.message}"`;
    case "webhook":
      return `call the webhook at ${action.url}`;
  }
}

/** Every leaf predicate in a condition tree, flattened — for callers that
 * need to iterate every metric a rule references regardless of tree shape
 * (e.g. per-metric chart threshold markers, search-by-metric filtering). */
export function leafPredicates(node: ConditionNode): ConditionLeaf[] {
  return node.kind === "leaf" ? [node] : node.predicates.flatMap(leafPredicates);
}

function leafClause(leaf: ConditionLeaf): string {
  const op = OPERATOR_WORDS[leaf.operator] ?? leaf.operator;
  return `${leaf.metric} ${op} ${leaf.threshold}`;
}

/** Recursive — a bare leaf is the common case, but this also renders a real
 * nested tree correctly for display even though RuleForm only ever builds a
 * flat one-level group (see RuleForm.tsx's module docstring). */
function conditionClause(node: ConditionNode): string {
  if (node.kind === "leaf") return leafClause(node);
  const joiner = node.op === "AND" ? " and " : " or ";
  return node.predicates.map(conditionClause).join(joiner);
}

export function ruleSummaryText(rule: RuleSummaryData): string {
  const holds = rule.for_duration > 0 ? ` for ${rule.for_duration}s` : "";
  const action = actionClause(parseAction(rule.action));
  return `When ${conditionClause(rule.condition)}${holds}, ${action}.`;
}

function ConditionText({ node }: { node: ConditionNode }) {
  if (node.kind === "leaf") {
    const op = OPERATOR_WORDS[node.operator] ?? node.operator;
    return (
      <>
        <strong>{node.metric}</strong> {op} <strong>{node.threshold}</strong>
      </>
    );
  }
  const joiner = node.op === "AND" ? " and " : " or ";
  return (
    <>
      {node.predicates.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && joiner}
          <ConditionText node={child} />
        </Fragment>
      ))}
    </>
  );
}

/** The at-a-glance sentence UX_UI_Description.md §6 requires every rule to
 * render as — bolded values so it can be verified without reading closely. */
export function RuleSummary({ rule }: { rule: RuleSummaryData }) {
  const action = parseAction(rule.action);

  return (
    <p className="text-sm text-ink">
      When <ConditionText node={rule.condition} />
      {rule.for_duration > 0 && (
        <>
          {" "}
          for <strong>{rule.for_duration}s</strong>
        </>
      )}
      ,{" "}
      {action?.type === "actuator_command" ? (
        <>
          turn <strong>{action.actuator}</strong>{" "}
          <strong>{typeof action.value === "boolean" ? (action.value ? "ON" : "OFF") : String(action.value)}</strong>
        </>
      ) : action?.type === "notification" ? (
        <>
          send a notification: <strong>&ldquo;{action.message}&rdquo;</strong>
        </>
      ) : action?.type === "webhook" ? (
        <>
          call the webhook at <strong>{action.url}</strong>
        </>
      ) : (
        "do nothing (unrecognized action)"
      )}
      .
    </p>
  );
}
