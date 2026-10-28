"use client";

import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { TableFooter } from "@/components/list/TableFooter";
import { usePager } from "@/components/list/usePager";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { RULE_STATE, actionsText, ruleStateKey, triggerText } from "@/lib/rule-text";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const STATE = RULE_STATE;

/** This device's rules as Line rows (demo H): name, the rule as a sentence,
 * its state and a chevron to the rule. Managed from /rules — no inline
 * enable/delete here. */
export function RuleList({ deviceId }: { deviceId: string }) {
  const { can } = usePermissions();
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  // Paged in the browser: a device rarely has more than a page of rules.
  const pager = usePager(rules ?? []);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-14" />;
  if (error) {
    return <ErrorState message={error instanceof ApiRequestError ? error.message : "Couldn't load rules."} onRetry={() => void mutate()} />;
  }

  if (!rules || rules.length === 0) {
    return (
      <EmptyState
        title="No rules use this device"
        description="A rule checks its readings the moment they arrive and acts on them."
        action={
          can("rules.write") ? (
            <Link href={`/rules/new?device=${deviceId}`} className={buttonClassName({ variant: "secondary" })}>
              <Plus aria-hidden size={15} />
              New rule
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
    <ul aria-label="Rules" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {pager.pageRows.map((r) => {
        const s = STATE[ruleStateKey(r)];
        return (
          <li key={r.id} className="border-t border-border-soft first:border-t-0">
            <Link href={`/rules/${r.id}`} className="flex min-h-12 min-w-0 items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-row-hover">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate font-medium text-ink">{r.name}</b>
                <span className="truncate text-xs text-ink-muted">
                  When {triggerText(r)}: {actionsText(r.actions)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2.5 text-xs text-ink-muted">
                {r.enabled && !r.health.evaluatable && <Tag tone="warn">Can&apos;t evaluate</Tag>}
                <Badge tone={s.tone} shape={s.shape} label={s.label} />
                <ChevronRight aria-hidden size={15} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
    <TableFooter shown={rules.length} total={rules.length} noun={["rule", "rules"]} page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} onPage={pager.setPage} onPageSize={pager.setPageSize} />
    </div>
  );
}
