"use client";

import { AlertCircle, Check } from "lucide-react";
import { TableFooter } from "@/components/list/TableFooter";
import { useServerPager } from "@/components/list/useServerPager";
import { Tag } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { formatWhen } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type RuleExecutionResponse = components["schemas"]["RuleExecutionResponse"];
type ActionExecutionResponse = components["schemas"]["ActionExecutionResponse"];

const ACTION_WORD: Record<string, string> = {
  get actuator_command() { return tr("editor.history.types.actuator_command"); },
  get webhook() { return tr("editor.history.types.webhook"); },
  get notification() { return tr("editor.history.types.notification"); },
  get email() { return tr("editor.history.types.email"); },
};

const SOURCE_TAG: Record<string, string> = {
  get schedule() { return tr("editor.history.scheduled"); },
  get manual() { return tr("editor.history.runNow"); },
};

/** What happened to one action, in words: "sent", "HTTP 503", the error. */
function outcome(a: ActionExecutionResponse): string {
  const d = a.detail ?? {};
  if (a.status === "success") return typeof d.status_code === "number" ? `HTTP ${d.status_code}` : tr("editor.history.sent");
  const reason = String(d.error ?? d.reason ?? tr("editor.history.failed")).replace(/_/g, " ");
  return typeof d.status_code === "number" ? `HTTP ${d.status_code}: ${reason}` : reason;
}

/** Recent firings (demo H Activity): one Line row each — when, what fired
 * (or cleared), and a ✓ or ⚠ per action with what happened. useRealtime's
 * rule_execution messages revalidate this key the moment a firing lands. */
export function RuleExecutionHistory({ ruleId }: { ruleId: string }) {
  // Paged by the API, so every firing can be browsed, not just the latest 100.
  const pager = useServerPager<RuleExecutionResponse>(`/rules/${ruleId}/executions`);
  const { rows: data, total, isLoading, error, mutate } = pager;

  if (isLoading && data.length === 0) return <LoadingSkeleton rows={3} rowClassName="h-10" />;
  if (error) {
    return <ErrorState message={error instanceof ApiRequestError ? error.message : tr("editor.history.loadFailed")} onRetry={() => void mutate()} />;
  }
  if (total === 0) return <p className="text-sm text-ink-muted">{tr("editor.history.empty")}</p>;

  return (
    <div className="flex flex-col gap-2">
    <ul aria-label={tr("editor.peek.recent")} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-border-soft px-3.5 py-2.5 text-sm first:border-t-0">
          <span className="min-w-[104px] whitespace-nowrap text-xs tabular-nums text-ink-muted">{formatWhen(e.fired_at)}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <b className="font-medium text-ink">{e.summary}</b>
              {e.edge === "clear" && <Tag size="sm">{tr("editor.history.cleared")}</Tag>}
              {SOURCE_TAG[e.trigger_source] && <Tag size="sm">{SOURCE_TAG[e.trigger_source]}</Tag>}
            </span>
            {e.actions.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
                {a.status === "success" ? (
                  <Check aria-label={tr("editor.history.done")} size={13} className="shrink-0 text-status-online" />
                ) : (
                  <AlertCircle aria-label={tr("editor.history.failedLabel")} size={13} className="shrink-0 text-status-error" />
                )}
                {ACTION_WORD[a.action_type] ?? a.action_type}: {outcome(a)}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
    <TableFooter shown={total} total={total} noun={["firing", "firings"]} page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} onPage={pager.setPage} onPageSize={pager.setPageSize} />
    </div>
  );
}
