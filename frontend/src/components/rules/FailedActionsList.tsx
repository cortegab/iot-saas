"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { DataTable, type DataColumn } from "@/components/list/DataTable";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type FailedActionResponse = components["schemas"]["FailedActionResponse"];

const ACTION_TYPE_LABELS: Record<string, string> = {
  actuator_command: "Actuator command",
  webhook: "Webhook",
  notification: "In-app notification",
  email: "Email",
  unknown: "Unknown",
};

function detailSummary(detail: FailedActionResponse["detail"]): string {
  if (!detail) return "No details";
  const d = detail as Record<string, unknown>;
  if (typeof d.error === "string") return d.error;
  if (typeof d.reason === "string") return String(d.reason).replace(/_/g, " ");
  if (typeof d.status_code === "number") return `HTTP ${d.status_code}`;
  return JSON.stringify(detail);
}

/** Tenant-wide "what delivery is broken right now" feed — webhooks/emails that
 * exhausted their retries, unresolvable actuator targets, etc. Refreshed live
 * by useRealtime's rule_execution messages. */
export function FailedActionsList() {
  const { data, error, isLoading, mutate } = useApiSWR<FailedActionResponse[]>("/rules/failed-actions");

  if (error) {
    return (
      <ErrorState
        title="Couldn't load failed deliveries"
        message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (isLoading || !data) return <TableSkeleton rows={4} columns={4} />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 aria-hidden size={26} />}
        title="Nothing failed"
        description="Webhook, email and actuator deliveries that fail show up here with the reason."
      />
    );
  }

  const columns: DataColumn<FailedActionResponse>[] = [
    {
      id: "when",
      header: "When",
      cell: (a) => (
        <span className="whitespace-nowrap text-ink-muted" title={new Date(a.created_at).toLocaleString()}>
          {timeAgo(a.created_at)}
        </span>
      ),
    },
    {
      id: "rule",
      header: "Rule",
      cell: (a) => (
        <div className="flex min-w-0 flex-col">
          {a.rule_id ? (
            <Link href={`/rules/${a.rule_id}`} className="font-medium text-ink hover:text-accent hover:underline">
              {a.rule_name ?? "Rule"}
            </Link>
          ) : (
            <span className="text-ink-muted">{a.rule_name ?? "Deleted rule"}</span>
          )}
          {a.summary && <span className="block max-w-[44ch] truncate text-xs text-ink-muted">{a.summary}</span>}
        </div>
      ),
    },
    {
      id: "action",
      header: "Action",
      hideOnPhone: true,
      cell: (a) => ACTION_TYPE_LABELS[a.action_type] ?? a.action_type,
    },
    {
      id: "error",
      header: "Error",
      cell: (a) => (
        <span className="text-xs text-status-error" title={a.detail ? JSON.stringify(a.detail) : undefined}>
          {detailSummary(a.detail)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <DataTable label="Failed deliveries" columns={columns} rows={data} rowKey={(a) => a.id} />
      <p className="px-0.5 text-xs text-ink-muted">
        {data.length} failed {data.length === 1 ? "delivery" : "deliveries"}
      </p>
    </div>
  );
}
