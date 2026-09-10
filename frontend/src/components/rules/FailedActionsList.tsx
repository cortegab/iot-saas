"use client";

import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Table, type TableColumn } from "@/components/ui/Table";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type FailedActionResponse = components["schemas"]["FailedActionResponse"];

const ACTION_TYPE_LABELS: Record<string, string> = {
  actuator_command: "Actuator",
  webhook: "Webhook",
  notification: "Notification",
  email: "Email",
  unknown: "Unknown",
};

function detailSummary(detail: FailedActionResponse["detail"]): string {
  if (!detail) return "—";
  const d = detail as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  if (typeof d.reason === "string") return String(d.reason).replace(/_/g, " ");
  if (typeof d.status_code === "number") return `HTTP ${d.status_code}`;
  return JSON.stringify(detail);
}

/** Tenant-wide "what delivery is broken right now" feed — webhooks/emails that
 * exhausted their retries, unresolvable actuator targets, etc. Modelled on
 * RuleExecutionHistory; refreshed live by useRealtime's rule_execution
 * messages. */
export function FailedActionsList() {
  const { data, error, isLoading, mutate } = useApiSWR<FailedActionResponse[]>(
    "/rules/failed-actions",
  );

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-10" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load failed actions."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Nothing failed"
        description="Actions that fail to deliver (a webhook that times out, an email that bounces) show up here."
      />
    );
  }

  const columns: TableColumn<FailedActionResponse>[] = [
    {
      header: "When",
      render: (a) => (
        <span className="text-ink-muted" title={new Date(a.created_at).toLocaleString()}>
          {timeAgo(a.created_at)}
        </span>
      ),
    },
    {
      header: "Rule",
      render: (a) =>
        a.rule_id ? (
          <Link href={`/rules/${a.rule_id}`} className="text-accent hover:underline">
            {a.rule_name ?? "rule"}
          </Link>
        ) : (
          <span className="text-ink-muted">{a.rule_name ?? "(deleted)"}</span>
        ),
    },
    {
      header: "Action",
      render: (a) => (
        <Badge tone="error" label={ACTION_TYPE_LABELS[a.action_type] ?? a.action_type} />
      ),
    },
    {
      header: "Detail",
      render: (a) => (
        <span className="text-ink-muted" title={a.detail ? JSON.stringify(a.detail) : undefined}>
          {detailSummary(a.detail)}
        </span>
      ),
    },
  ];

  return <Table columns={columns} rows={data} rowKey={(a) => a.id} />;
}
