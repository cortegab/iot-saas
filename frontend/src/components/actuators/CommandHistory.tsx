"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/lib/api-client";
import { commandStatus, commandStatusLabel, commandStatusTone, type CommandStatus } from "@/lib/command-status";
import type { components } from "@/types/api";

type CommandResponse = components["schemas"]["CommandResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The command timeline (DESIGN.md §8): when, which actuator and value, who
 * or which rule sent it, and what happened — filterable by result and
 * actuator. useRealtime's command_ack messages revalidate this key the moment
 * an ack lands; the interval is a fallback. */
export function CommandHistory({ deviceId }: { deviceId: string }) {
  const { data, error, isLoading, mutate } = useApiSWR<CommandResponse[]>(`/devices/${deviceId}/commands`, { refreshInterval: 20_000 });
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const [result, setResult] = useState<"" | CommandStatus>("");
  const [actuator, setActuator] = useState("");

  // "Pending" turns into "No response" at the TTL deadline; re-render while any wait.
  const [, tick] = useState(0);
  const anyPending = (data ?? []).some((c) => commandStatus(c) === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyPending]);

  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);
  const actuators = useMemo(() => [...new Set((data ?? []).map((c) => c.actuator))].sort(), [data]);

  if (isLoading) return <LoadingSkeleton rows={3} rowClassName="h-10" />;
  if (error) {
    return (
      <ErrorState message={error instanceof ApiRequestError ? error.message : "Couldn't load command history."} onRetry={() => void mutate()} />
    );
  }
  if (!data || data.length === 0) {
    return <EmptyState title="No commands yet" description="Actuator commands, manual or rule-fired, appear here." />;
  }

  const rows = data.filter((c) => (!result || commandStatus(c) === result) && (!actuator || c.actuator === actuator));

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Result"
          value={result}
          onChange={(v) => setResult(v as "" | CommandStatus)}
          options={[
            { value: "", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "confirmed", label: "Acknowledged" },
            { value: "no-response", label: "No response" },
          ]}
        />
        {actuators.length > 1 && (
          <Select aria-label="Actuator" value={actuator} onChange={(e) => setActuator(e.target.value)} className="w-auto">
            <option value="">All actuators</option>
            {actuators.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        )}
        <span className="ml-auto text-[12.5px] text-ink-muted">
          {rows.length} of {data.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No commands match.</p>
      ) : (
        <ol aria-label="Commands" className="flex flex-col border-l-2 border-border pl-4">
          {rows.map((c) => {
            const status = commandStatus(c);
            const rule = c.rule_id ? ruleName.get(c.rule_id) : null;
            return (
              <li
                key={c.id}
                className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-border-soft py-2 text-sm before:absolute before:-left-[23px] before:top-3.5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-accent before:bg-surface last:border-b-0 @min-[600px]:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <span className="text-[12.5px] tabular-nums text-ink-muted">{time(c.published_at)}</span>
                <span className="col-span-full min-w-0 @min-[600px]:col-span-1 @min-[600px]:order-none">
                  <span className="font-mono text-ink">{c.actuator}</span> → <b className="font-medium text-ink">{formatValue(c.value)}</b>
                  <span className="text-ink-muted">
                    {" · "}
                    {c.rule_id ? (
                      <Link href={`/rules/${c.rule_id}`} className="hover:text-accent hover:underline">
                        {rule ?? "a rule"}
                      </Link>
                    ) : (
                      "Manual"
                    )}
                  </span>
                </span>
                <span className="row-start-1 justify-self-end @min-[600px]:row-start-auto">
                  <Badge tone={commandStatusTone(status)} variant="dot" label={commandStatusLabel(status)} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
