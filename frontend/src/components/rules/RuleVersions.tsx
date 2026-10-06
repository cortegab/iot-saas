"use client";

import { History, RotateCcw } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];

/** A rule's saved states, newest first (DESIGN.md §9 Versions). Restore
 * loads an older one into the editor as a draft; saving it is a normal save
 * and becomes the newest version. */
export function RuleVersions({
  ruleId,
  canRestore,
  onRestore,
}: {
  ruleId: string;
  canRestore: boolean;
  onRestore: (v: RuleVersionResponse) => void;
}) {
  const { data, error, isLoading, mutate } = useApiSWR<RuleVersionResponse[]>(`/rules/${ruleId}/versions`);

  if (error) {
    return <ErrorState title="Couldn't load versions" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />;
  }
  if (isLoading || !data) return <LoadingSkeleton rows={3} rowClassName="h-16" />;
  if (data.length === 0) {
    return <EmptyState icon={<History aria-hidden size={24} />} title="No versions yet" description="Each save from now on is kept here, with what changed." />;
  }

  return (
    <ol aria-label="Versions" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      {data.map((v, i) => (
        <li key={v.id} className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
          <span className="grid h-8 w-10 shrink-0 place-items-center rounded-md bg-surface-raised font-mono text-[13px] text-ink">v{v.version}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="font-medium">{v.author ?? "API key or removed member"}</span>
              <span className="text-ink-muted" title={formatWhen(v.created_at)}>
                {timeAgo(v.created_at)}
              </span>
              {i === 0 && <Badge tone="online" label="Current" />}
            </p>
            <ul className="flex flex-col gap-0.5 text-[13px] text-ink-muted">
              {v.change_lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {i > 0 && canRestore && (
            <Button size="sm" variant="secondary" onClick={() => onRestore(v)}>
              <RotateCcw aria-hidden size={13} />
              Restore
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}
