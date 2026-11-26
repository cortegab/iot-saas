"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ListChecks, Plus } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { LadderOverview } from "@/components/rules/ladder/LadderOverview";
import { RulePeek } from "@/components/rules/RulePeek";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { usePeek } from "@/components/list/usePeek";
import { FailedActionsList } from "@/components/rules/FailedActionsList";
import { useRuleActions } from "@/components/rules/useRuleActions";
import { useServerPager } from "@/components/list/useServerPager";
import { ApiRequestError } from "@/lib/api-client";
import { RULE_STATE, actionsText, ruleStateKey, sharedActuators, triggerKindText, triggerText, type RuleStateKey } from "@/lib/rule-text";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];
type FailedActionResponse = components["schemas"]["FailedActionResponse"];

/** The Trigger filter (DESIGN.md §6 rules list). */
const TRIGGERS = [
  { value: "metric", get label() { return t("rules.triggers.metric"); } },
  { value: "schedule", get label() { return t("rules.triggers.schedule"); } },
  { value: "manual", get label() { return t("rules.triggers.manual"); } },
  { value: "device_status", get label() { return t("rules.triggers.device_status"); } },
];

const triggerType = (r: RuleResponse) => ((r.trigger as Record<string, unknown>).type as string | undefined) ?? "metric";

/** Unique devices a rule touches, in a stable order. */
function ruleDevices(rule: RuleResponse): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of rule.devices) if (!seen.has(d.device_id)) seen.set(d.device_id, d.device_name ?? t("rules.unnamedDevice"));
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function devicesLine(rule: RuleResponse): string {
  const ds = ruleDevices(rule);
  if (ds.length === 0) return "no devices";
  const shown = ds.slice(0, 3).map((d) => d.name).join(" · ");
  return ds.length > 3 ? `${shown} +${ds.length - 3}` : shown;
}

export default function RulesPage() {
  const { can } = usePermissions();
  const { simple } = useInterfaceMode();
  const canWrite = can("rules.write");
  // refreshInterval: rule health is time-based (a signal crosses its staleness
  // bound with no user action), and the rule_health realtime event only fires
  // for tenants with a live worker — this is the belt-and-suspenders.
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>("/rules", { refreshInterval: 30_000 });

  const list = useListState({ state: "all", device: "all", trigger: "all", view: "list" }, { key: "name", dir: "asc" });
  // Failed deliveries is the status filter's last state (DESIGN.md §6): its
  // count is the feed's X-Total-Count, the same first page FailedActionsList asks for.
  const { total: failedTotal } = useServerPager<FailedActionResponse>("/rules/failed-actions");
  const showFailed = list.filters.state === "failed";

  const shared = useMemo(() => sharedActuators(rules ?? []), [rules]);
  // The mini strips; rule_execution frames revalidate rules, this follows.
  const { data: activity } = useApiSWR<RuleActivityResponse[]>("/rules/activity", { refreshInterval: 60_000 });
  const activityByRule = useMemo(() => new Map((activity ?? []).map((a) => [a.rule_id, a])), [activity]);

  const deviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rules ?? []) for (const d of ruleDevices(r)) map.set(d.id, d.name);
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rules]);

  const firedIn24h = useCallback((r: RuleResponse) => (activityByRule.get(r.id)?.fired ?? 0) > 0, [activityByRule]);

  const counts = useMemo(() => {
    const c = { armed: 0, latched: 0, disabled: 0, stale: 0, fired: 0 };
    for (const r of rules ?? []) {
      c[ruleStateKey(r)] += 1;
      if (firedIn24h(r)) c.fired += 1;
    }
    return c;
  }, [rules, firedIn24h]);

  const filtered = useMemo(() => {
    const rows = (rules ?? []).filter((r) => {
      const st = list.filters.state;
      if (st === "fired" ? !firedIn24h(r) : st !== "all" && ruleStateKey(r) !== st) return false;
      if (list.filters.trigger !== "all" && triggerType(r) !== list.filters.trigger) return false;
      if (list.filters.device !== "all" && !ruleDevices(r).some((d) => d.id === list.filters.device)) return false;
      return matchesQuery(list.q, r.name, devicesLine(r), triggerText(r), actionsText(r.actions));
    });
    return sortRows(rows, list.sort, (r, key) => {
      if (key === "state") return ["armed", "stale", "latched", "disabled"].indexOf(ruleStateKey(r));
      if (key === "trigger") return triggerText(r);
      return r.name;
    });
  }, [rules, list.filters, list.q, list.sort, firedIn24h]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);
  // A row peeks (DESIGN.md §7); a rule is edited on /rules/{id}.
  const peek = usePeek({ rows: pageRows, rowKey: (r) => r.id, pageHref: (id) => `/rules/${id}`, newHref: "/rules/new" });

  const actions = useRuleActions();

  /** Under the name (demo H): the last 24 hours as a strip and "fired N×",
   * or the schedule, then what needs a look (shares an actuator). Can't evaluate
   * is the State column's one state, not said twice. */
  function activityLine(r: RuleResponse) {
    const a = activityByRule.get(r.id);
    const schedule = r.trigger.type === "schedule";
    // The current cell shows today's health: stale inputs are unknown (hatched), never "idle".
    const cells: StripCell[] = a ? [...a.cells] : [];
    if (r.enabled && !r.health.evaluatable && cells.length > 0 && cells[cells.length - 1] === "idle") cells[cells.length - 1] = "unknown";
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {!schedule && a && <MiniStrip cells={cells} label={t("editor.peek.firedTimes", { count: a.fired })} />}
        <span>{schedule ? triggerText(r) : a ? (a.fired ? t("editor.peek.firedLower", { count: a.fired }) : t("editor.peek.quietLower")) : devicesLine(r)}</span>
        {shared.get(r.id)?.map((x) => (
          <Tag key={x} tone="warn" size="sm">
            <AlertTriangle aria-hidden size={11} />
            shares {x}
          </Tag>
        ))}
      </span>
    );
  }

  // demo H: Rule (with its last day folded in) · Trigger · Action · State · ⋯
  const columns: DataColumn<RuleResponse>[] = [
    {
      id: "name",
      header: t("rules.rule"),
      sortable: true,
      cell: (r) => (
        <NameCell
          name={
            <Link href={`/rules/${r.id}`} className="hover:underline hover:underline-offset-[3px]">
              {r.name}
            </Link>
          }
          sub={activityLine(r)}
        />
      ),
    },
    {
      id: "trigger",
      header: t("rules.trigger"),
      sortable: true,
      hideOnPhone: true,
      priority: 3,
      fold: (r) => triggerKindText(r),
      cell: (r) => <span className="text-ink">{triggerKindText(r)}</span>,
    },
    { id: "action", header: t("rules.action"), hideOnPhone: true, priority: 2, fold: (r) => actionsText(r.actions), cell: (r) => <span className="text-ink">{actionsText(r.actions)}</span> },
    {
      id: "state",
      header: t("rules.state"),
      sortable: true,
      cell: (r) => {
        const s = RULE_STATE[ruleStateKey(r)];
        return <Badge tone={s.tone} shape={s.shape} variant="dot" label={s.label} />;
      },
    },
  ];

  const rowMenu = (r: RuleResponse) => actions.menu(r);

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: t("devices.chipSearch", { q: list.q }), onRemove: () => list.setQuery("") });
  if (list.filters.state !== "all" && !showFailed) {
    const label = list.filters.state === "fired" ? t("rules.firedDay") : RULE_STATE[list.filters.state as RuleStateKey]?.label;
    chips.push({ id: "state", label: t("rules.chipState", { state: label ?? "" }), onRemove: () => list.setFilter("state", "all") });
  }
  if (list.filters.device !== "all") {
    const name = deviceOptions.find((d) => d.value === list.filters.device)?.label ?? t("devices.unknown");
    chips.push({ id: "device", label: t("rules.chipDevice", { name }), onRemove: () => list.setFilter("device", "all") });
  }
  if (list.filters.trigger !== "all") {
    const label = TRIGGERS.find((x) => x.value === list.filters.trigger)?.label ?? list.filters.trigger;
    chips.push({ id: "trigger", label: t("rules.chipTrigger", { name: label }), onRemove: () => list.setFilter("trigger", "all") });
  }

  const total = rules?.length ?? 0;
  const newAction = canWrite ? (
    <Link href="/rules/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {t("rules.new")}
    </Link>
  ) : null;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title={t(simple ? "nav.automations" : "rules.title")}
        description={t("rules.description")}
        actions={!error && rules && total > 0 ? undefined : newAction}
      />

      {error ? (
        <ErrorState
          title={t("rules.loadFailed")}
          message={t("rules.keepRunning", { message: error instanceof ApiRequestError ? error.message : t("devices.apiDown") })}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !rules ? (
        <TableSkeleton rows={5} columns={4} />
      ) : total === 0 ? (
        <FirstUse
          icon={<ListChecks aria-hidden size={26} />}
          title={t("rules.emptyTitle")}
          description={t("rules.emptyBody")}
          action={newAction ?? undefined}
          readOnlyNote={t("rules.askAdmin")}
        />
      ) : (
        <>
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder={t("rules.search")}
            searchable={!showFailed}
            activeFilters={[list.filters.device, list.filters.trigger].filter((v) => v !== "all").length}
            actions={newAction}
            quick={{
              label: t("rules.filterState"),
              value: list.filters.state,
              onChange: (v) => list.setFilter("state", v),
              options: [
                { value: "all", label: t("devices.all"), count: total },
                { value: "armed", label: RULE_STATE.armed.label, count: counts.armed, tone: "online", hint: t("rules.hints.armed") },
                { value: "fired", label: t("rules.fired"), count: counts.fired, tone: "accent", hint: t("rules.hints.fired") },
                { value: "latched", label: RULE_STATE.latched.label, count: counts.latched, tone: "pending", shape: "square", hint: t("rules.hints.latched"), alert: true },
                { value: "stale", label: RULE_STATE.stale.label, count: counts.stale, tone: "unknown", shape: "hollow", hint: t("rules.hints.stale"), alert: true },
                { value: "disabled", label: RULE_STATE.disabled.label, count: counts.disabled, tone: "unknown", shape: "square", hint: t("rules.hints.disabled") },
                // Deliveries, not rules: the feed replaces the table.
                { value: "failed", label: t("rules.failed"), count: failedTotal, tone: "offline", hint: t("rules.hints.failed"), alert: true },
              ],
            }}
            view={
              // Simple view (DESIGN.md §15a) has no ladder.
              showFailed || simple ? undefined : <SegmentedControl
                ariaLabel={t("rules.view")}
                value={list.filters.view === "ladder" ? "ladder" : "list"}
                onChange={(v) => list.setFilter("view", v)}
                options={[
                  { value: "list", label: t("rules.list") },
                  { value: "ladder", label: t("rules.ladder") },
                ]}
              />
            }
          >
            {!showFailed && (
            <>
            <Select
              aria-label={t("rules.filterDevice")}
              value={list.filters.device}
              onChange={(e) => list.setFilter("device", e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">{t("rules.allDevices")}</option>
              {deviceOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("rules.filterTrigger")}
              value={list.filters.trigger}
              onChange={(e) => list.setFilter("trigger", e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">{t("rules.allTriggers")}</option>
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            </>
            )}
          </ListToolbar>

          <FilterChips chips={chips} onClearAll={list.clearAll} />

          {showFailed ? (
            <FailedActionsList />
          ) : filtered.length === 0 ? (
            <NoResults noun={t("rules.nounMany")} hidden={total} onClear={list.clearAll} />
          ) : list.filters.view === "ladder" && !simple ? (
            <div className="flex flex-col gap-2">
              <LadderOverview rules={pageRows} />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={[t("rules.nounOne"), t("rules.nounMany")]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
          ) : (
            <ListWithPeek
              label={t("rules.rule")}
              onClose={peek.close}
              nav={peek.nav}
              peek={
                peek.peekId
                  ? (
                      <RulePeek
                        rule={rules.find((r) => r.id === peek.peekId)}
                        activity={activityByRule.get(peek.peekId!)}
                        shares={shared.get(peek.peekId!)}
                        onClose={peek.close}
                        menu={(r) => actions.menu(r, { where: "peek", onDeleted: peek.close })}
                      />
                    )
                  : null
              }
            >
            <div className="flex flex-col gap-2">
              <DataTable
                label={t("rules.title")}
                columns={columns}
                rows={pageRows}
                rowKey={(r) => r.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={peek.onRowClick}
                onRowEnter={peek.onRowEnter}
                currentKey={peek.peekId}
                rowMenu={rowMenu}
                rowMenuLabel={(r) => `Actions for ${r.name}`}
                inactive={(r) => !r.enabled}
              />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={[t("rules.nounOne"), t("rules.nounMany")]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
            </ListWithPeek>
          )}
        </>
      )}
      {actions.dialog}
    </>
  );
}
