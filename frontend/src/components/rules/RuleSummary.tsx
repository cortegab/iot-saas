import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type ActuatorCommandAction = components["schemas"]["ActuatorCommandAction"];
type NotificationAction = components["schemas"]["NotificationAction"];
type WebhookAction = components["schemas"]["WebhookAction"];
export type RuleAction = ActuatorCommandAction | NotificationAction | WebhookAction;

/** What the summary needs — a full RuleResponse satisfies this structurally,
 * but RuleForm's live preview (no id/device_id/created_at yet) can too. */
export type RuleSummaryData = Pick<
  RuleResponse,
  "metric" | "operator" | "threshold" | "for_duration" | "action"
>;

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

export function ruleSummaryText(rule: RuleSummaryData): string {
  const op = OPERATOR_WORDS[rule.operator] ?? rule.operator;
  const holds = rule.for_duration > 0 ? ` for ${rule.for_duration}s` : "";
  const action = actionClause(parseAction(rule.action));
  return `When ${rule.metric} ${op} ${rule.threshold}${holds}, ${action}.`;
}

/** The at-a-glance sentence UX_UI_Description.md §6 requires every rule to
 * render as — bolded values so it can be verified without reading closely. */
export function RuleSummary({ rule }: { rule: RuleSummaryData }) {
  const op = OPERATOR_WORDS[rule.operator] ?? rule.operator;
  const action = parseAction(rule.action);

  return (
    <p className="text-sm text-ink">
      When <strong>{rule.metric}</strong> {op} <strong>{rule.threshold}</strong>
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
