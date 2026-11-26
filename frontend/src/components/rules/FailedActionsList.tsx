"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCw } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { TableFooter } from "@/components/list/TableFooter";
import { useServerPager } from "@/components/list/useServerPager";
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
import { tActive as tr } from "@iodriven/shared/i18n";

type FailedActionResponse = components["schemas"]["FailedActionResponse"];

const ACTION_TYPE_LABELS: Record<string, string> = {
  get actuator_command() { return tr("editor.failed.types.actuator_command"); },
  get webhook() { return tr("editor.failed.types.webhook"); },
  get notification() { return tr("editor.failed.types.notification"); },
  get email() { return tr("editor.failed.types.email"); },
  get unknown() { return tr("editor.failed.types.unknown"); },
};

function detailSummary(detail: FailedActionResponse["detail"]): string {
  if (!detail) return tr("editor.failed.noDetails");
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
  // Paged by the API, so every failure can be browsed, not just the latest 100.
  const pager = useServerPager<FailedActionResponse>("/rules/failed-actions");
  const { rows: data, total, isLoading, error, mutate } = pager;

  async function retry(a: FailedActionResponse) {
    setRetrying(a.id);
    try {
      await api.post(`/rules/failed-actions/${a.id}/retry`);
      // The new attempt lands in the background; a failure comes back as a
      // fresh row (and a notification), success just clears this one.
      await mutate();
      toast({ tone: "info", title: tr("editor.failed.retrying"), detail: tr("editor.failed.retryingDetail", { action: ACTION_TYPE_LABELS[a.action_type] ?? a.action_type, rule: a.rule_name ?? tr("editor.failed.theRule") }) });
    } catch (err) {
      toast({ tone: "error", title: tr("editor.failed.retryFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setRetrying(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title={tr("editor.failed.loadFailed")}
        message={error instanceof ApiRequestError ? error.message : tr("devices.apiDown")}
        onRetry={() => void mutate()}
      />
    );
  }
  if (isLoading && data.length === 0) return <TableSkeleton rows={4} columns={4} />;
  if (total === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 aria-hidden size={26} />}
        title={tr("editor.failed.emptyTitle")}
        description={tr("editor.failed.emptyBody")}
      />
    );
  }

  const columns: DataColumn<FailedActionResponse>[] = [
    {
      id: "when",
      header: tr("editor.failed.when"),
      cell: (a) => (
        <span className="whitespace-nowrap text-ink-muted" title={new Date(a.created_at).toLocaleString()}>
          {timeAgo(a.created_at)}
        </span>
      ),
    },
    {
      id: "rule",
      header: tr("editor.failed.rule"),
      cell: (a) => (
        <div className="flex min-w-0 flex-col">
          {a.rule_id ? (
            <Link href={`/rules/${a.rule_id}`} className="font-medium text-ink hover:text-accent hover:underline">
              {a.rule_name ?? tr("editor.failed.rule")}
            </Link>
          ) : (
            <span className="text-ink-muted">{a.rule_name ?? tr("editor.failed.deletedRule")}</span>
          )}
          {a.summary && <span className="block max-w-[44ch] truncate text-xs text-ink-muted">{a.summary}</span>}
        </div>
      ),
    },
    {
      id: "action",
      header: tr("editor.failed.action"),
      hideOnPhone: true,
      cell: (a) => ACTION_TYPE_LABELS[a.action_type] ?? a.action_type,
    },
    {
      id: "error",
      header: tr("editor.failed.error"),
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
            header: tr("editor.failed.retry"),
            cell: (a: FailedActionResponse) =>
              RETRYABLE.has(a.action_type) ? (
                <Button size="sm" variant="secondary" disabled={retrying === a.id} onClick={() => void retry(a)}>
                  <RotateCw aria-hidden size={13} />
                  {retrying === a.id ? tr("editor.failed.retryingDots") : tr("editor.failed.retry")}
                </Button>
              ) : (
                <span className="text-xs text-ink-muted" title={tr("editor.failed.notRetriedHint")}>
                  {tr("editor.failed.notRetried")}
                </span>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <DataTable label={tr("editor.failed.label")} columns={columns} rows={data} rowKey={(a) => a.id} />
      <TableFooter
        shown={total}
        total={total}
        noun={["failed delivery", "failed deliveries"]}
        page={pager.page}
        pageCount={pager.pageCount}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
        onPageSize={pager.setPageSize}
      />
    </div>
  );
}
