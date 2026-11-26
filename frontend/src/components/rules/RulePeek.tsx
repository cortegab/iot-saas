"use client";

import Link from "next/link";
import { AlertCircle, Check } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge, Tag } from "@/components/ui/Badge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { PeekFrame, PeekOpen, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { RULE_STATE, actionsText, ruleStateKey, triggerText } from "@/lib/rule-text";
import { formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];
type RuleExecutionResponse = components["schemas"]["RuleExecutionResponse"];

const STATE = RULE_STATE;

/** A rule at a glance: what it watches and does, its last day, and whether it
 * shares an actuator. It's edited on /rules/{id}. */
export function RulePeek({
  rule,
  activity,
  shares,
  onClose,
  menu,
}: {
  rule: RuleResponse | undefined;
  activity: RuleActivityResponse | undefined;
  /** Actuators another enabled rule also drives. */
  shares: string[] | undefined;
  onClose: () => void;
  /** The record's ⋯ menu (useRuleActions, `where: "peek"`). */
  menu: (r: RuleResponse) => DropdownMenuItem[][];
}) {
  // The latest few firings; the full, paged history is on the rule's Activity tab.
  const { data: firings } = useApiSWR<RuleExecutionResponse[]>(rule ? `/rules/${rule.id}/executions?limit=3` : null);
  if (!rule) return <PeekPlaceholder noun="rule" missing onClose={onClose} />;
  const r = rule;

  const state = STATE[ruleStateKey(r)];
  // The 24 h activity only knows recent firings; older ones come from the history.
  const lastFired = activity?.last_fired_at ?? firings?.find((e) => e.edge !== "clear")?.fired_at;
  const devices = Array.from(new Map(r.devices.map((d) => [d.device_id, d.device_name ?? tr("rules.unnamedDevice")])));
  const cells: StripCell[] = activity ? [...activity.cells] : [];
  if (r.enabled && !r.health.evaluatable && cells.length > 0 && cells[cells.length - 1] === "idle") cells[cells.length - 1] = "unknown";


  return (
    <>
      <PeekFrame
        noun="rule"
        title={r.name}
        eyebrow={
          <>
            <Badge tone={state.tone} shape={state.shape} label={state.label} />
            {r.enabled && !r.health.evaluatable && <Tag tone="warn">{tr("status.rule.stale")}</Tag>}
          </>
        }
        description={
          <>
            When <code className="font-mono text-xs text-ink">{triggerText(r)}</code>, {actionsText(r.actions)}.
          </>
        }
        facts={[
          [tr("editor.peek.lastFired"), r.trigger.type === "schedule" ? null : lastFired ? timeAgo(lastFired) : tr("editor.peek.never")],
          [
            tr("editor.peek.devices"),
            devices.length ? (
              <span className="flex flex-col gap-0.5">
                {devices.map(([id, name]) => (
                  <Link key={id} href={`/devices/${id}`} className="font-mono text-meta text-accent hover:underline">
                    {name}
                  </Link>
                ))}
              </span>
            ) : (
              tr("editor.peek.none")
            ),
          ],
          [
            tr("editor.peek.shares"),
            shares?.length ? (
              <span className="flex flex-wrap gap-1">
                {shares.map((a) => (
                  <Tag key={a} tone="warn" size="sm">
                    {a}
                  </Tag>
                ))}
              </span>
            ) : null,
          ],
        ]}
        primary={<PeekOpen href={`/rules/${r.id}`} noun="rule" />}
        menu={menu(r)}
        onClose={onClose}
      >
        {r.trigger.type !== "schedule" && activity && (
          <PeekSection title={tr("editor.peek.last24")}>
            <MiniStrip cells={cells} label={tr("editor.peek.firedTimes", { count: activity.fired })} />
            <p className="text-xs text-ink-muted">{activity.fired ? tr("editor.peek.firedX", { count: activity.fired }) : tr("editor.peek.quiet")}</p>
          </PeekSection>
        )}
        {firings && firings.length > 0 && (
          <PeekSection title={tr("editor.peek.recent")}>
            <ul aria-label={tr("editor.peek.recent")} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
              {firings.map((e) => {
                const failed = e.actions.some((a) => a.status !== "success");
                return (
                  <li key={e.id} className="flex min-h-11 items-center gap-3 border-t border-border-soft px-3.5 py-2 text-sm first:border-t-0">
                    {failed ? (
                      <AlertCircle aria-label={tr("editor.peek.actionFailed")} size={14} className="shrink-0 text-status-error" />
                    ) : (
                      <Check aria-label={tr("editor.peek.done")} size={14} className="shrink-0 text-status-online" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-ink">{e.summary}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-ink-muted">{formatWhen(e.fired_at)}</span>
                  </li>
                );
              })}
            </ul>
          </PeekSection>
        )}
      </PeekFrame>
    </>
  );
}
