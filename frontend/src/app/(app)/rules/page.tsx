"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { AlertTriangle, ListChecks, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { LadderOverview } from "@/components/rules/ladder/LadderOverview";
import { RulePeek } from "@/components/rules/RulePeek";
import { SplitView } from "@/components/editor/SplitView";
import { usePeek } from "@/components/list/usePeek";
import { RulesTabs } from "@/components/rules/RulesTabs";
import { ApiRequestError } from "@/lib/api-client";
import { actionsText, ruleStateKey, sharedActuators, triggerText, type RuleStateKey } from "@/lib/rule-text";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const STATE: Record<RuleStateKey, { label: string; tone: "online" | "pending" | "unknown"; shape: "solid" | "square" }> = {
  armed: { label: "Armed", tone: "online", shape: "solid" },
  latched: { label: "Latched", tone: "pending", shape: "square" },
  disabled: { label: "Disabled", tone: "unknown", shape: "square" },
};

/** Unique devices a rule touches, in a stable order. */
function ruleDevices(rule: RuleResponse): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of rule.devices) if (!seen.has(d.device_id)) seen.set(d.device_id, d.device_name ?? "Unnamed device");
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function devicesLine(rule: RuleResponse): string {
  const ds = ruleDevices(rule);
  if (ds.length === 0) return "no devices";
  const shown = ds.slice(0, 3).map((d) => d.name).join(" · ");
  return ds.length > 3 ? `${shown} +${ds.length - 3}` : shown;
}

export default function RulesPage() {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("rules.write");
  const { confirm, dialog } = useConfirm();
  // refreshInterval: rule health is time-based (a signal crosses its staleness
  // bound with no user action), and the rule_health realtime event only fires
  // for tenants with a live worker — this is the belt-and-suspenders.
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>("/rules", { refreshInterval: 30_000 });

  const list = useListState({ state: "all", device: "all", view: "list" }, { key: "name", dir: "asc" });

  const shared = useMemo(() => sharedActuators(rules ?? []), [rules]);
  // The mini strips; rule_execution frames revalidate rules, this follows.
  const { data: activity } = useApiSWR<RuleActivityResponse[]>("/rules/activity", { refreshInterval: 60_000 });
  const activityByRule = useMemo(() => new Map((activity ?? []).map((a) => [a.rule_id, a])), [activity]);

  const deviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rules ?? []) for (const d of ruleDevices(r)) map.set(d.id, d.name);
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rules]);

  const counts = useMemo(() => {
    const c = { armed: 0, latched: 0, disabled: 0, stale: 0 };
    for (const r of rules ?? []) {
      c[ruleStateKey(r)] += 1;
      if (r.enabled && !r.health.evaluatable) c.stale += 1;
    }
    return c;
  }, [rules]);

  const filtered = useMemo(() => {
    const rows = (rules ?? []).filter((r) => {
      const st = list.filters.state;
      if (st === "stale" ? !(r.enabled && !r.health.evaluatable) : st !== "all" && ruleStateKey(r) !== st) return false;
      if (list.filters.device !== "all" && !ruleDevices(r).some((d) => d.id === list.filters.device)) return false;
      return matchesQuery(list.q, r.name, devicesLine(r), triggerText(r), actionsText(r.actions));
    });
    return sortRows(rows, list.sort, (r, key) => {
      if (key === "state") return ["armed", "latched", "disabled"].indexOf(ruleStateKey(r));
      if (key === "trigger") return triggerText(r);
      return r.name;
    });
  }, [rules, list.filters, list.q, list.sort]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);
  // A row peeks (DESIGN.md §7); a rule is edited on /rules/{id}.
  const peek = usePeek({ rows: pageRows, rowKey: (r) => r.id, pageHref: (id) => `/rules/${id}`, newHref: "/rules/new" });

  // A rule's device pages cache their rules under `/devices/{id}/rules`.
  function afterChange(rule: RuleResponse) {
    void mutate();
    for (const d of rule.devices) void revalidate(`/devices/${d.device_id}/rules`);
  }

  async function setEnabled(rule: RuleResponse, enabled: boolean, undoable = true) {
    try {
      await api.patch(`/rules/${rule.id}`, { enabled });
      afterChange(rule);
      toast({
        title: `${rule.name} ${enabled ? "enabled" : "disabled"}`,
        detail: enabled ? "Fires when its trigger and conditions are met." : "Keeps its settings and history, but won't fire.",
        action: undoable ? { label: "Undo", onClick: () => void setEnabled(rule, !enabled, false) } : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Resolves true once the rule is deleted. */
  async function remove(rule: RuleResponse): Promise<boolean> {
    const ok = await confirm(
      "It stops evaluating immediately. Actuators keep their current state. This can't be undone; to pause it instead, disable it.",
      { title: `Delete ${rule.name}?`, confirmLabel: "Delete rule" },
    );
    if (!ok) return false;
    try {
      await api.delete(`/rules/${rule.id}`);
      afterChange(rule);
      toast({ title: `${rule.name} deleted` });
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
      return false;
    }
  }

  const columns: DataColumn<RuleResponse>[] = [
    {
      id: "name",
      header: "Rule",
      sortable: true,
      cell: (r) => (
        <div className="flex min-w-0 flex-col gap-1">
          <NameCell
            name={
              <Link href={`/rules/${r.id}`} className="hover:underline hover:underline-offset-[3px]">
                {r.name}
              </Link>
            }
            sub={devicesLine(r)}
          />
          {shared.has(r.id) && (
            <span className="flex flex-wrap gap-1.5">
              {shared.get(r.id)!.map((a) => (
                <Tag key={a} tone="warn" size="sm">
                  <AlertTriangle aria-hidden size={11} />
                  shares {a}
                </Tag>
              ))}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "trigger",
      header: "When",
      sortable: true,
      hideOnPhone: true,
      cell: (r) => <code className="font-mono text-xs text-ink">{triggerText(r)}</code>,
    },
    { id: "action", header: "Then", hideOnPhone: true, cell: (r) => <span className="text-ink">{actionsText(r.actions)}</span> },
    {
      id: "activity",
      header: "Last 24 h",
      hideOnPhone: true,
      cell: (r) => {
        // Schedule rules fire on their schedule; the strip would say nothing.
        if (r.trigger.type === "schedule") return <span className="text-xs text-ink-muted">{triggerText(r)}</span>;
        const a = activityByRule.get(r.id);
        if (!a) return <span className="text-xs text-ink-muted">—</span>;
        // The current cell shows today's health: stale inputs are unknown
        // (hatched), never "idle".
        const cells: StripCell[] = [...a.cells];
        if (r.enabled && !r.health.evaluatable && cells.length > 0 && cells[cells.length - 1] === "idle") cells[cells.length - 1] = "unknown";
        return (
          <span className="flex flex-col gap-1">
            <MiniStrip cells={cells} label={`Fired ${a.fired} time${a.fired === 1 ? "" : "s"} in 24 h`} />
            <span className="text-[11.5px] text-ink-muted">{a.fired ? `fired ${a.fired}× in 24 h` : "quiet in 24 h"}</span>
          </span>
        );
      },
    },
    {
      id: "state",
      header: "State",
      sortable: true,
      cell: (r) => {
        const s = STATE[ruleStateKey(r)];
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.tone} shape={s.shape} label={s.label} />
            {r.enabled && !r.health.evaluatable && <Tag tone="warn">Can&apos;t evaluate</Tag>}
          </span>
        );
      },
    },
  ];

  const rowMenu = (r: RuleResponse): DropdownMenuItem[][] => {
    const groups: DropdownMenuItem[][] = [
      [{ label: canWrite ? "Edit" : "View", icon: <Pencil size={15} />, onClick: () => router.push(`/rules/${r.id}`) }],
    ];
    if (canWrite) {
      groups.push(
        [{ label: r.enabled ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => void setEnabled(r, !r.enabled) }],
        [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(r) }],
      );
    }
    return groups;
  };

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") });
  if (list.filters.state !== "all") {
    const label = list.filters.state === "stale" ? "Can't evaluate" : STATE[list.filters.state as RuleStateKey]?.label;
    chips.push({ id: "state", label: `State: ${label}`, onRemove: () => list.setFilter("state", "all") });
  }
  if (list.filters.device !== "all") {
    const name = deviceOptions.find((d) => d.value === list.filters.device)?.label ?? "unknown";
    chips.push({ id: "device", label: `Device: ${name}`, onRemove: () => list.setFilter("device", "all") });
  }

  const total = rules?.length ?? 0;
  const newAction = canWrite ? (
    <Link href="/rules/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      New rule
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Rules"
        description="Evaluated in memory the moment a reading arrives. Breach to actuator command is typically under 500 ms."
        actions={newAction}
      />
      <RulesTabs active="rules" />

      {error ? (
        <ErrorState
          title="Couldn't load rules"
          message={`${error instanceof ApiRequestError ? error.message : "The API didn't respond."} Rules keep running; only this page is affected.`}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !rules ? (
        <TableSkeleton rows={5} columns={4} />
      ) : total === 0 ? (
        <FirstUse
          icon={<ListChecks aria-hidden size={26} />}
          title="No rules yet"
          description="Rules watch live readings and switch actuators or notify people within two seconds."
          action={newAction ?? undefined}
          readOnlyNote="Ask an admin to create the first rule."
        />
      ) : (
        <>
          <KpiStrip
            ariaLabel="Filter by state"
            active={list.filters.state === "all" ? null : list.filters.state}
            onSelect={(id) => list.setFilter("state", list.filters.state === id ? "all" : id)}
            items={[
              { id: "armed", label: "Armed", value: counts.armed, sub: "ready to fire", tone: "online" },
              { id: "latched", label: "Latched", value: counts.latched, sub: "waiting for a reset", tone: "pending", shape: "square" },
              { id: "stale", label: "Can't evaluate", value: counts.stale, sub: "an input isn't reporting", tone: "offline" },
              { id: "disabled", label: "Disabled", value: counts.disabled, sub: "won't fire", tone: "unknown", shape: "square" },
            ]}
          />

          <ListToolbar query={list.q} onQuery={list.setQuery} placeholder="Search rules, devices or actions">
            <Select
              aria-label="Filter by device"
              value={list.filters.device}
              onChange={(e) => list.setFilter("device", e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">All devices</option>
              {deviceOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
            <SegmentedControl
              ariaLabel="Rules view"
              value={list.filters.view === "ladder" ? "ladder" : "list"}
              onChange={(v) => list.setFilter("view", v)}
              options={[
                { value: "list", label: "List" },
                { value: "ladder", label: "Ladder" },
              ]}
            />
          </ListToolbar>

          <FilterChips chips={chips} onClearAll={list.clearAll} />

          {filtered.length === 0 ? (
            <NoResults noun="rules" hidden={total} onClear={list.clearAll} />
          ) : list.filters.view === "ladder" ? (
            <LadderOverview rules={filtered} />
          ) : (
            <SplitView
              editorLabel="Rule"
              onClose={peek.close}
              editor={
                peek.peekId
                  ? (mode) => (
                      <RulePeek
                        key={peek.peekId}
                        rule={rules.find((r) => r.id === peek.peekId)}
                        activity={activityByRule.get(peek.peekId!)}
                        shares={shared.get(peek.peekId!)}
                        mode={mode}
                        onClose={peek.close}
                        onToggle={(r) => void setEnabled(r, !r.enabled)}
                        onDelete={(r) => void remove(r).then((gone) => gone && peek.close())}
                      />
                    )
                  : null
              }
            >
            <div className="flex flex-col gap-2">
              <DataTable
                label="Rules"
                // The peek repeats When/Then; dropping them keeps the state readable beside it.
                columns={peek.peekId ? columns.filter((c) => c.id !== "trigger" && c.id !== "action") : columns}
                rows={pageRows}
                rowKey={(r) => r.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={peek.onRowClick}
                onRowEnter={peek.onRowEnter}
                currentKey={peek.peekId}
                rowMenu={rowMenu}
                rowMenuLabel={(r) => `Actions for ${r.name}`}
                rowClassName={(r) => (r.enabled ? undefined : "[&>td]:opacity-60")}
              />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={["rule", "rules"]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
            </SplitView>
          )}
        </>
      )}
      {dialog}
    </>
  );
}
