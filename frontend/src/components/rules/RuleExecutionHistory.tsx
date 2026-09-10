"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Table, type TableColumn } from "@/components/ui/Table";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleExecutionResponse = components["schemas"]["RuleExecutionResponse"];
type ActionExecutionResponse = components["schemas"]["ActionExecutionResponse"];

const ACTION_TYPE_LABELS: Record<string, string> = {
  actuator_command: "Actuator",
  webhook: "Webhook",
  notification: "Notification",
  unknown: "Unknown",
};

function ActionBadges({ actions }: { actions: ActionExecutionResponse[] }) {
  if (actions.length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a) => (
        <span key={a.id} title={a.detail ? JSON.stringify(a.detail) : undefined}>
          <Badge
            tone={a.status === "success" ? "online" : "error"}
            label={ACTION_TYPE_LABELS[a.action_type] ?? a.action_type}
          />
        </span>
      ))}
    </div>
  );
}

/** Read-only execution history for one rule — every time it fired and what
 * happened to each configured action (actuator dispatched/failed, webhook
 * posted with its status code, notification sent). useRealtime's
 * rule_execution messages revalidate this key the moment a new firing lands;
 * this is a rule-detail-page tab a user views on demand, so no polling
 * fallback interval (unlike CommandHistory/notifications, viewed
 * continuously).
 */
export function RuleExecutionHistory({ ruleId }: { ruleId: string }) {
  const { data, error, isLoading, mutate } = useApiSWR<RuleExecutionResponse[]>(
    `/rules/${ruleId}/executions`,
  );

  if (isLoading) return <LoadingSkeleton rows={3} rowClassName="h-10" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load execution history."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Every time this rule fires, what happened will appear here."
      />
    );
  }

  const columns: TableColumn<RuleExecutionResponse>[] = [
    {
      header: "Fired",
      render: (e) => (
        <span className="text-ink-muted" title={new Date(e.fired_at).toLocaleString()}>
          {timeAgo(e.fired_at)}
        </span>
      ),
    },
    { header: "Summary", render: (e) => <span>{e.summary}</span> },
    { header: "Actions", render: (e) => <ActionBadges actions={e.actions} /> },
  ];

  return <Table columns={columns} rows={data} rowKey={(e) => e.id} />;
}
