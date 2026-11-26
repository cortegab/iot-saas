"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Cpu, Plus, Power, Trash2 } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DeviceTile } from "@/components/devices/DeviceTile";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { capital, words } from "@/lib/simple-words";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { BulkBar, FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { DevicePeek } from "@/components/devices/DevicePeek";
import { useDeviceActions } from "@/components/devices/useDeviceActions";
import { usePeek } from "@/components/list/usePeek";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { ApiRequestError } from "@/lib/api-client";
import { DEVICE_STATUS, deviceStatusKey, type DeviceStatusKey } from "@/lib/device-status";
import { ageMinutes, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

/** DESIGN.md §6 catalog standard for Devices: toolbar (with the status
 * filter and its counts), chips, bulk actions, sortable table, footer,
 * designed states. */
export default function DevicesPage() {
  const { can } = usePermissions();
  const canWrite = can("devices.write");

  const { data: devices, error, isLoading, mutate } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");

  const list = useListState({ status: "all", template: "all", zone: "all", view: "auto" }, { key: "name", dir: "asc" });
  // Tiles by zone (DESIGN.md §8, §15a): the default in Simple view, a toggle in Full.
  const { simple } = useInterfaceMode();
  const w = words(simple);
  const view = list.filters.view === "tiles" || list.filters.view === "table" ? list.filters.view : simple ? "tiles" : "table";
  const zoneName = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templateName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of templates ?? []) m.set(t.id, t.name);
    return m;
  }, [templates]);

  const rulesPerDevice = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules ?? []) {
      for (const id of new Set(r.devices.map((d) => d.device_id))) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [rules]);

  const counts = useMemo(() => {
    const c: Record<DeviceStatusKey, number> = { online: 0, offline: 0, never: 0, disabled: 0 };
    for (const d of devices ?? []) c[deviceStatusKey(d)] += 1;
    return c;
  }, [devices]);

  const filtered = useMemo(() => {
    const rows = (devices ?? []).filter(
      (d) =>
        (list.filters.status === "all" || deviceStatusKey(d) === list.filters.status) &&
        (list.filters.template === "all" || d.catalog_entry_id === list.filters.template) &&
        (list.filters.zone === "all" ||
          (list.filters.zone === "none" ? d.zone_id == null : d.zone_id === list.filters.zone)) &&
        matchesQuery(list.q, d.name, d.slug, templateName.get(d.catalog_entry_id), d.zone_id ? zoneName.get(d.zone_id) : null),
    );
    return sortRows(rows, list.sort, (d, key) => {
      if (key === "template") return templateName.get(d.catalog_entry_id) ?? "";
      if (key === "zone") return d.zone_id ? (zoneName.get(d.zone_id) ?? "") : null;
      if (key === "status") return DEVICE_STATUS[deviceStatusKey(d)].order;
      if (key === "seen") return ageMinutes(d.last_seen_at);
      return d.name;
    });
  }, [devices, list.filters, list.q, list.sort, templateName, zoneName]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);
  // A row peeks (DESIGN.md §7); a device is opened and edited on its page.
  const peek = usePeek({ rows: pageRows, rowKey: (d) => d.id, pageHref: (id) => `/devices/${id}`, newHref: "/devices/new" });

  // ---------------------------------------------------------------- actions
  const actions = useDeviceActions({ onChanged: () => mutate(), ruleCount: (id) => rulesPerDevice.get(id) ?? 0 });
  const { setEnabled } = actions;
  async function remove(targets: DeviceResponse[]): Promise<boolean> {
    const gone = await actions.remove(targets);
    if (gone) setSelected(new Set());
    return gone;
  }

  // ---------------------------------------------------------------- table
  const columns: DataColumn<DeviceResponse>[] = [
    {
      id: "name",
      header: t("devices.device"),
      sortable: true,
      cell: (d) => (
        <NameCell
          name={
            <span className="flex items-center gap-2">
              <Link href={`/devices/${d.id}`} className="hover:underline hover:underline-offset-[3px]">
                {d.name}
              </Link>
              {d.simulated && <Tag size="sm">{t("devices.simulated")}</Tag>}
            </span>
          }
          // demo H: the name in the UI face, its MQTT id under it in mono.
          sub={<span className="font-mono text-xs">{d.slug}</span>}
        />
      ),
    },
    {
      id: "template",
      header: capital(w.template),
      sortable: true,
      hideOnPhone: true,
      priority: 3,
      fold: (d) => templateName.get(d.catalog_entry_id),
      cell: (d) => (
        <>
          {templateName.get(d.catalog_entry_id) ?? <span className="text-ink-muted">—</span>}
          {d.hardware && (
            <Tag size="sm" className="ml-1.5">
              {t("devices.ownWiring")}
            </Tag>
          )}
        </>
      ),
    },
    {
      id: "zone",
      header: capital(w.zone),
      sortable: true,
      hideOnPhone: true,
      priority: 2,
      fold: (d) => (d.zone_id ? zoneName.get(d.zone_id) : null),
      cell: (d) => (d.zone_id ? zoneName.get(d.zone_id) : null) ?? <span className="text-ink-muted">—</span>,
    },
    { id: "status", header: t("devices.status"), sortable: true, cell: (d) => <DeviceStatusPill device={d} /> },
    {
      id: "seen",
      header: t("devices.lastSeen"),
      sortable: true,
      numeric: true,
      cell: (d) => <span className="text-ink-muted">{timeAgo(d.last_seen_at)}</span>,
    },
  ];

  const rowMenu = (d: DeviceResponse) => actions.menu(d);

  // ---------------------------------------------------------------- chips
  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: t("devices.chipSearch", { q: list.q }), onRemove: () => list.setQuery("") });
  if (list.filters.status !== "all") {
    chips.push({
      id: "status",
      label: t("devices.chipStatus", { status: DEVICE_STATUS[list.filters.status as DeviceStatusKey]?.label ?? list.filters.status }),
      onRemove: () => list.setFilter("status", "all"),
    });
  }
  if (list.filters.zone !== "all") {
    chips.push({
      id: "zone",
      label: `${capital(w.zone)}: ${list.filters.zone === "none" ? t("devices.noneOf", { what: w.zone }) : (zoneName.get(list.filters.zone) ?? t("devices.unknown"))}`,
      onRemove: () => list.setFilter("zone", "all"),
    });
  }
  if (list.filters.template !== "all") {
    chips.push({
      id: "template",
      label: `${capital(w.template)}: ${templateName.get(list.filters.template) ?? t("devices.unknown")}`,
      onRemove: () => list.setFilter("template", "all"),
    });
  }

  const total = devices?.length ?? 0;
  const selectedRows = (devices ?? []).filter((d) => selected.has(d.id));
  const addAction = canWrite ? (
    <Link href="/devices/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {t("devices.add")}
    </Link>
  ) : null;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title={t("devices.title")}
        description={t("devices.description")}
        actions={!error && devices && total > 0 ? undefined : addAction}
      />

      {actions.reveal}

      {error ? (
        <ErrorState
          title={t("devices.loadFailed")}
          message={t("devices.keepRunning", { message: error instanceof ApiRequestError ? error.message : t("devices.apiDown") })}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !devices ? (
        <TableSkeleton rows={6} columns={4} />
      ) : total === 0 ? (
        <FirstUse
          icon={<Cpu aria-hidden size={28} />}
          title={t("devices.emptyTitle")}
          description={
            <>
              {t("devices.emptyBody")}{" "}
              <Link href="/devices/new?from=simulated" className="link-inline">
                {t("devices.trySimulated")}
              </Link>
              .
            </>
          }
          action={addAction ?? undefined}
          readOnlyNote={t("devices.askAdmin")}
        />
      ) : (
        <ListWithPeek
          label={t("devices.device")}
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? (() => {
                  const d = devices.find((x) => x.id === peek.peekId);
                  return (
                    <DevicePeek
                      device={d}
                      template={d ? templates?.find((t) => t.id === d.catalog_entry_id) : undefined}
                      zoneName={d?.zone_id ? zoneName.get(d.zone_id) : undefined}
                      ruleCount={d ? (rulesPerDevice.get(d.id) ?? 0) : 0}
                      onClose={peek.close}
                      menu={(x) => actions.menu(x, { where: "peek", onDeleted: peek.close })}
                    />
                  );
                })()
              : null
          }
        >
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder={t("devices.search", { template: w.template })}
            activeFilters={[list.filters.template, list.filters.zone].filter((v) => v !== "all").length}
            actions={addAction}
            view={
              <SegmentedControl
                ariaLabel={t("devices.view")}
                value={view}
                onChange={(v) => list.setFilter("view", v)}
                options={[
                  { value: "table", label: t("devices.table") },
                  { value: "tiles", label: t("devices.tiles") },
                ]}
              />
            }
            quick={{
              label: t("devices.filterStatus"),
              value: list.filters.status,
              onChange: (v) => list.setFilter("status", v),
              options: [
                { value: "all", label: t("devices.all"), count: total },
                { value: "online", label: DEVICE_STATUS.online.label, count: counts.online, tone: "online", hint: t("devices.hintOnline") },
                { value: "offline", label: DEVICE_STATUS.offline.label, count: counts.offline, tone: "offline", hint: t("devices.hintOffline"), alert: true },
                { value: "never", label: DEVICE_STATUS.never.label, count: counts.never, tone: "pending", shape: "hollow", hint: t("devices.hintNever") },
                { value: "disabled", label: DEVICE_STATUS.disabled.label, count: counts.disabled, tone: "unknown", shape: "square", hint: t("devices.hintDisabled") },
              ],
            }}
          >
            <Select
              aria-label={t("devices.filterBy", { what: w.template })}
              value={list.filters.template}
              onChange={(e) => list.setFilter("template", e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">{t("devices.allOf", { what: w.templates })}</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("devices.filterBy", { what: w.zone })}
              value={list.filters.zone}
              onChange={(e) => list.setFilter("zone", e.target.value)}
              className="w-auto min-w-[150px]"
            >
              <option value="all">{t("devices.allOf", { what: w.zones })}</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
              <option value="none">{t("devices.noneOf", { what: w.zone })}</option>
            </Select>
          </ListToolbar>

          <FilterChips chips={chips} onClearAll={list.clearAll} />

          {canWrite && (
            <BulkBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
              <Button variant="secondary" size="sm" onClick={() => void setEnabled(selectedRows, false).then(() => setSelected(new Set()))}>
                <Power aria-hidden size={14} />
                {t("devices.disable")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void setEnabled(selectedRows, true).then(() => setSelected(new Set()))}>
                <Power aria-hidden size={14} />
                {t("devices.enable")}
              </Button>
              <Button variant="secondary-danger" size="sm" onClick={() => void remove(selectedRows)}>
                <Trash2 aria-hidden size={14} />
                {t("devices.deleteDots")}
              </Button>
            </BulkBar>
          )}

          {filtered.length === 0 ? (
            <NoResults noun={t("devices.nounMany")} hidden={total} onClear={list.clearAll} />
          ) : view === "tiles" ? (
            <div className="flex flex-col gap-5">
              {groupByZone(pageRows, zoneName, t("devices.noneOf", { what: w.zone })).map((g) => (
                <section key={g.key} aria-label={g.label} className="flex flex-col gap-2.5">
                  <h2 className="text-sm font-semibold text-ink">{g.label}</h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
                    {g.devices.map((d) => (
                      <DeviceTile key={d.id} device={d} template={templates?.find((t) => t.id === d.catalog_entry_id)} />
                    ))}
                  </div>
                </section>
              ))}
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={[t("devices.nounOne"), t("devices.nounMany")]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <DataTable
                label="Devices"
                columns={columns}
                rows={pageRows}
                rowKey={(d) => d.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={peek.onRowClick}
                onRowEnter={peek.onRowEnter}
                selection={canWrite ? { selected, onChange: setSelected, rowLabel: (d) => d.name } : undefined}
                rowMenu={rowMenu}
                rowMenuLabel={(d) => t("devices.actionsFor", { name: d.name })}
                inactive={(d) => d.status === "disabled"}
                currentKey={peek.peekId}
              />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={[t("devices.nounOne"), t("devices.nounMany")]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
          )}
        </ListWithPeek>
      )}
      {actions.dialog}
    </>
  );
}

/** Tiles grouped by zone, in zone-name order, devices without one last. */
function groupByZone(rows: DeviceResponse[], zoneName: Map<string, string>, noZone: string) {
  const groups = new Map<string, { key: string; label: string; devices: DeviceResponse[] }>();
  for (const d of rows) {
    const key = d.zone_id && zoneName.has(d.zone_id) ? d.zone_id : "none";
    const label = key === "none" ? noZone : zoneName.get(key)!;
    if (!groups.has(key)) groups.set(key, { key, label, devices: [] });
    groups.get(key)!.devices.push(d);
  }
  return [...groups.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label)));
}
