"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCw } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
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
const RETRYABLE = new Set(["webhook", "email"]);

export function FailedActionsList() {
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const canRetry = can("rules.write");
  const [retrying, setRetrying] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useApiSWR<FailedActionResponse[]>("/rules/failed-actions");

  async function retry(a: FailedActionResponse) {
    setRetrying(a.id);
    try {
      await api.post(`/rules/failed-actions/${a.id}/retry`);
      // The new attempt lands in the background; a failure comes back as a
      // fresh row (and a notification), success just clears this one.
      await mutate();
      toast({ tone: "info", title: "Retrying the delivery", detail: `${ACTION_TYPE_LABELS[a.action_type] ?? a.action_type} for ${a.rule_name ?? "the rule"}` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't retry", detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setRetrying(null);
    }
  }

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
    ...(canRetry
      ? [
          {
            id: "retry",
            header: "Retry",
            cell: (a: FailedActionResponse) =>
              RETRYABLE.has(a.action_type) ? (
                <Button size="sm" variant="secondary" disabled={retrying === a.id} onClick={() => void retry(a)}>
                  <RotateCw aria-hidden size={13} />
                  {retrying === a.id ? "Retrying…" : "Retry"}
                </Button>
              ) : (
                <span className="text-xs text-ink-muted" title="A late actuator command could act on state that has moved on. The rule fires again when its condition holds.">
                  Not retried
                </span>
              ),
          },
        ]
      : []),
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
