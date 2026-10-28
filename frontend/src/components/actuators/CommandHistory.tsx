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

  // A run of commands to the same actuator from the same sender with the same
  // result, one after another, reads as one row with ×N (a device that didn't
  // answer would otherwise fill the page with near-copies). ×N expands it.
  const runs = useMemo(() => {
    const out: { items: CommandResponse[]; status: CommandStatus }[] = [];
    for (const c of rows) {
      const status = commandStatus(c);
      const prev = out[out.length - 1];
      if (prev && prev.status === status && prev.items[0].actuator === c.actuator && prev.items[0].rule_id === c.rule_id) prev.items.push(c);
      else out.push({ items: [c], status });
    }
    return out;
  }, [rows]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  type Shown = { items: CommandResponse[]; status: CommandStatus; collapsed: boolean; runId?: string };
  const shown = runs.flatMap((r): Shown[] => {
    const runId = r.items.length > 1 ? r.items[0].id : undefined;
    if (runId && !open.has(runId)) return [{ items: r.items, status: r.status, collapsed: true, runId }];
    return r.items.map((c, i) => ({ items: [c], status: r.status, collapsed: false, runId: i === 0 ? runId : undefined }));
  });
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
          {shown.map(({ items, status, collapsed, runId }) => {
            const c = items[0];
            const last = items[items.length - 1];
            const count = items.length;
            // Values in the run, newest first, without repeats ("On / Off").
            const values = [...new Set(items.map((x) => formatValue(x.value)))].join(" / ");
            const rule = c.rule_id ? ruleName.get(c.rule_id) : null;
            return (
              <li
                key={c.id}
                className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-border-soft py-2 text-sm before:absolute before:-left-[23px] before:top-3.5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-accent before:bg-surface last:border-b-0 @min-[600px]:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <span className="text-[12.5px] tabular-nums text-ink-muted">
                  {/* Newest first: a run spans from its oldest to its newest. */}
                  {count > 1 ? `${time(last.published_at)} – ${time(c.published_at)}` : time(c.published_at)}
                </span>
                <span className="col-span-full min-w-0 @min-[600px]:col-span-1 @min-[600px]:order-none">
                  <span className="text-ink">{name(c.actuator)}</span> → <b className="font-medium text-ink">{count > 1 ? values : formatValue(c.value)}</b>
                  {runId && (
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() => toggle(runId)}
                      className="hit ml-1.5 rounded bg-surface-raised px-[5px] align-[1px] text-[10.5px] font-medium text-ink hover:text-accent"
                    >
                      {collapsed ? `×${count}` : "Collapse"}
                    </button>
                  )}
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
