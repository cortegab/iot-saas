"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Cpu, Plus, Power, Trash2 } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Badge";
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

  const list = useListState({ status: "all", template: "all", zone: "all" }, { key: "name", dir: "asc" });
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
      header: "Device",
      sortable: true,
      cell: (d) => (
        <NameCell
          name={
            <Link href={`/devices/${d.id}`} className="hover:underline hover:underline-offset-[3px]">
              {d.name}
            </Link>
          }
          // demo H: the name in the UI face, its MQTT id under it in mono.
          sub={<span className="font-mono text-[11.5px]">{d.slug}</span>}
        />
      ),
    },
    {
      id: "template",
      header: "Template",
      sortable: true,
      hideOnPhone: true,
      priority: 3,
      fold: (d) => templateName.get(d.catalog_entry_id),
      cell: (d) => (
        <>
          {templateName.get(d.catalog_entry_id) ?? <span className="text-ink-muted">—</span>}
          {d.hardware && (
            <Tag size="sm" className="ml-1.5">
              Own wiring
            </Tag>
          )}
        </>
      ),
    },
    {
      id: "zone",
      header: "Zone",
      sortable: true,
      hideOnPhone: true,
      priority: 2,
      fold: (d) => (d.zone_id ? zoneName.get(d.zone_id) : null),
      cell: (d) => (d.zone_id ? zoneName.get(d.zone_id) : null) ?? <span className="text-ink-muted">—</span>,
    },
    { id: "status", header: "Status", sortable: true, cell: (d) => <DeviceStatusPill device={d} /> },
    {
      id: "seen",
      header: "Last seen",
      sortable: true,
      numeric: true,
      cell: (d) => <span className="text-ink-muted">{timeAgo(d.last_seen_at)}</span>,
    },
  ];

  const rowMenu = (d: DeviceResponse) => actions.menu(d);

  // ---------------------------------------------------------------- chips
  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") });
  if (list.filters.status !== "all") {
    chips.push({
      id: "status",
      label: `Status: ${DEVICE_STATUS[list.filters.status as DeviceStatusKey]?.label ?? list.filters.status}`,
      onRemove: () => list.setFilter("status", "all"),
    });
  }
  if (list.filters.zone !== "all") {
    chips.push({
      id: "zone",
      label: `Zone: ${list.filters.zone === "none" ? "No zone" : (zoneName.get(list.filters.zone) ?? "unknown")}`,
      onRemove: () => list.setFilter("zone", "all"),
    });
  }
  if (list.filters.template !== "all") {
    chips.push({
      id: "template",
      label: `Template: ${templateName.get(list.filters.template) ?? "unknown"}`,
      onRemove: () => list.setFilter("template", "all"),
    });
  }

  const total = devices?.length ?? 0;
  const selectedRows = (devices ?? []).filter((d) => selected.has(d.id));
  const addAction = canWrite ? (
    <Link href="/devices/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      Add device
    </Link>
  ) : null;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title="Devices"
        description="Open a device for its readings and controls."
        actions={!error && devices && total > 0 ? undefined : addAction}
      />

      {actions.reveal}

      {error ? (
        <ErrorState
          title="Couldn't load devices"
          message={`${error instanceof ApiRequestError ? error.message : "The API didn't respond."} Devices keep reporting and rules keep running; only this page is affected.`}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !devices ? (
        <TableSkeleton rows={6} columns={4} />
      ) : total === 0 ? (
        <FirstUse
          icon={<Cpu aria-hidden size={28} />}
          title="No devices yet"
          description="Add a device to get its MQTT credential and a ready-to-flash ESP32 sketch. Readings show up here within a second of the first publish."
          action={addAction ?? undefined}
          readOnlyNote="Ask an admin to add the first device."
        />
      ) : (
        <ListWithPeek
          label="Device"
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
            placeholder="Search name or template"
            activeFilters={[list.filters.template, list.filters.zone].filter((v) => v !== "all").length}
            actions={addAction}
            quick={{
              label: "Filter by status",
              value: list.filters.status,
              onChange: (v) => list.setFilter("status", v),
              options: [
                { value: "all", label: "All", count: total },
                { value: "online", label: "Online", count: counts.online, tone: "online", hint: "Reporting now" },
                { value: "offline", label: "Offline", count: counts.offline, tone: "offline", hint: "Not reporting now", alert: true },
                { value: "never", label: "Never connected", count: counts.never, tone: "pending", shape: "hollow", hint: "Waiting for the first message" },
                { value: "disabled", label: "Disabled", count: counts.disabled, tone: "unknown", shape: "square", hint: "Not evaluated by rules" },
              ],
            }}
          >
            <Select
              aria-label="Filter by template"
              value={list.filters.template}
              onChange={(e) => list.setFilter("template", e.target.value)}
              className="w-auto min-w-[170px]"
            >
              <option value="all">All templates</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by zone"
              value={list.filters.zone}
              onChange={(e) => list.setFilter("zone", e.target.value)}
              className="w-auto min-w-[150px]"
            >
              <option value="all">All zones</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
              <option value="none">No zone</option>
            </Select>
          </ListToolbar>

          <FilterChips chips={chips} onClearAll={list.clearAll} />

          {canWrite && (
            <BulkBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
              <Button variant="secondary" size="sm" onClick={() => void setEnabled(selectedRows, false).then(() => setSelected(new Set()))}>
                <Power aria-hidden size={14} />
                Disable
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void setEnabled(selectedRows, true).then(() => setSelected(new Set()))}>
                <Power aria-hidden size={14} />
                Enable
              </Button>
              <Button variant="danger" size="sm" onClick={() => void remove(selectedRows)}>
                <Trash2 aria-hidden size={14} />
                Delete
              </Button>
            </BulkBar>
          )}

          {filtered.length === 0 ? (
            <NoResults noun="devices" hidden={total} onClear={list.clearAll} />
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
                rowMenuLabel={(d) => `Actions for ${d.name}`}
                rowClassName={(d) => (d.status === "disabled" ? "[&>td]:opacity-60" : undefined)}
                currentKey={peek.peekId}
              />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={["device", "devices"]}
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
