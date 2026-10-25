"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { TableFooter } from "@/components/list/TableFooter";
import { useServerPager } from "@/components/list/useServerPager";
import { Badge } from "@/components/ui/Badge";
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

/** The API's name for each result filter (backend commands/service.py). */
const STATUS_PARAM: Record<CommandStatus, string> = { confirmed: "confirmed", pending: "pending", "no-response": "no_response" };

/** The command timeline (DESIGN.md §8): when, which actuator and value, who
 * or which rule sent it, and what happened — filtered by result and actuator
 * and paged by the API, so all of it can be browsed. useRealtime's command_ack
 * messages revalidate every loaded page the moment an ack lands; the interval
 * is a fallback. */
export function CommandHistory({ deviceId, labels }: { deviceId: string; /** Actuator wire id → its name. */ labels?: Map<string, string> }) {
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const [result, setResult] = useState<"" | CommandStatus>("");
  const [actuator, setActuator] = useState("");
  const pager = useServerPager<CommandResponse>(`/devices/${deviceId}/commands`, {
    params: { status: result ? STATUS_PARAM[result] : null, actuator: actuator || null },
    config: { refreshInterval: 20_000 },
  });
  const { rows, total, isLoading, error, mutate } = pager;
  const filtered = !!(result || actuator);

  // "Pending" turns into "No response" at the TTL deadline; re-render while any wait.
  const [, tick] = useState(0);
  const anyPending = rows.some((c) => commandStatus(c) === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyPending]);

  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);
  // The device's actuators (from its template and rules), not just the ones on this page.
  const actuators = useMemo(() => [...(labels?.keys() ?? [])].sort(), [labels]);

  const name = (a: string) => labels?.get(a) ?? a;
  const heading = <h2 className="text-[15px] font-semibold text-ink">Command timeline</h2>;

  if (isLoading && rows.length === 0) return <LoadingSkeleton rows={3} rowClassName="h-10" />;
  if (error) {
    return (
      <ErrorState message={error instanceof ApiRequestError ? error.message : "Couldn't load command history."} onRetry={() => void mutate()} />
    );
  }
  if (total === 0 && !filtered) {
    return (
      <section className="flex flex-col gap-2">
        {heading}
        <p className="text-sm text-ink-muted">No commands yet. Commands sent by you or by rules appear here.</p>
      </section>
    );
  }

  return (
    <section className="@container flex flex-col gap-3">
      {/* The heading with its filters on one row (demo H). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {heading}
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
                  {name(a)}
                </option>
              ))}
            </Select>
          )}
        </div>
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
                  <span className="text-ink">{name(c.actuator)}</span> → <b className="font-medium text-ink">{formatValue(c.value)}</b>
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
      {total > 0 && (
        <TableFooter
          shown={total}
          total={total}
          noun={["command", "commands"]}
          page={pager.page}
          pageCount={pager.pageCount}
          pageSize={pager.pageSize}
          onPage={pager.setPage}
          onPageSize={pager.setPageSize}
        />
      )}
    </section>
  );
}
