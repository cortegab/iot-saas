"use client";

import { RotateCcw } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { formatWhen } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];

/** A rule's saved states, newest first (demo H Versions): "Version N ·
 * current", who and when, and what changed. Restore loads an older one into
 * the editor as a draft; saving it is a normal save and becomes the newest. */
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
  if (isLoading || !data) return <LoadingSkeleton rows={3} rowClassName="h-12" />;
  if (data.length === 0) return <p className="text-sm text-ink-muted">Each save from now on is kept here, with what changed.</p>;

  return (
    <ol aria-label="Versions" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {data.map((v, i) => (
        <li key={v.id} className="flex min-h-12 items-center gap-3 border-t border-border-soft px-3.5 py-2.5 text-sm first:border-t-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="font-medium text-ink">
              Version {v.version}
              {i === 0 ? " · current" : ""}
            </b>
            <span className="text-[12.5px] text-ink-muted">
              {[v.author ?? "API key or removed member", formatWhen(v.created_at), v.change_lines.join("; ")].filter(Boolean).join(" · ")}
            </span>
          </span>
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
