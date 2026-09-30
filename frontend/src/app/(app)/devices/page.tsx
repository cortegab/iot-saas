"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Cpu, KeyRound, Pencil, Plus, Power, SquareArrowOutUpRight, Trash2, Wrench } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { BulkBar, FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { DeviceEditor } from "@/components/devices/DeviceEditor";
import { SplitView } from "@/components/editor/SplitView";
import { ApiRequestError } from "@/lib/api-client";
import { DEVICE_STATUS, deviceStatusKey, type DeviceStatusKey } from "@/lib/device-status";
import { ageMinutes, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** DESIGN.md §6 catalog standard for Devices: KPI strip (status filter),
 * toolbar, chips, bulk actions, sortable table, footer, designed states. */
export default function DevicesPage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("devices.write");
  const { confirm, dialog } = useConfirm();

  const { data: devices, error, isLoading, mutate } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");

  const list = useListState({ status: "all", template: "all", zone: "all" }, { key: "name", dir: "asc" });
  const zoneName = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // `?edit=<id>` docks the device editor beside the list (DESIGN.md §7).
  const params = useSearchParams();
  const pathname = usePathname();
  const editId = params.get("edit");
  function setEditId(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("edit", id);
    else next.delete("edit");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  const [revealed, setRevealed] = useState<{ name: string; credential: DeviceCreateResponse["credential"] } | null>(null);

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

  // ---------------------------------------------------------------- actions
  async function setEnabled(targets: DeviceResponse[], enabled: boolean, undoable = true) {
    try {
      for (const d of targets) await api.patch(`/devices/${d.id}`, { status: enabled ? "active" : "disabled" });
      await mutate();
      toast({
        title:
          targets.length === 1
            ? `${targets[0].name} ${enabled ? "enabled" : "disabled"}`
            : `${plural(targets.length, "device")} ${enabled ? "enabled" : "disabled"}`,
        detail: enabled
          ? "Rules evaluate them again from the next reading."
          : "Rules stop evaluating them and they can't connect. Telemetry history is kept.",
        action: undoable ? { label: "Undo", onClick: () => void setEnabled(targets, !enabled, false) } : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the device", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove(targets: DeviceResponse[]) {
    const ruleCount = targets.reduce((n, d) => n + (rulesPerDevice.get(d.id) ?? 0), 0);
    const one = targets.length === 1;
    const ok = await confirm(
      <p>
        {one ? "Its credential stops" : "Their credentials stop"} working immediately
        {ruleCount > 0 && (
          <>
            , <strong>{plural(ruleCount, "rule")}</strong> stop evaluating {one ? "it" : "them"}
          </>
        )}
        , and {one ? "its" : "their"} telemetry history is removed. This can&apos;t be undone. To pause{" "}
        {one ? "it" : "them"} instead, disable {one ? "it" : "them"}.
      </p>,
      {
        title: one ? `Delete ${targets[0].name}?` : `Delete ${plural(targets.length, "device")}?`,
        confirmLabel: one ? "Delete device" : `Delete ${plural(targets.length, "device")}`,
        details: one ? undefined : (
          <ul>
            {targets.map((d) => (
              <li key={d.id} className="font-mono">
                {d.name}
              </li>
            ))}
          </ul>
        ),
      },
    );
    if (!ok) return;
    try {
      for (const d of targets) await api.delete(`/devices/${d.id}`);
      setSelected(new Set());
      await mutate();
      toast({ title: one ? `${targets[0].name} deleted` : `${plural(targets.length, "device")} deleted` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete", detail: err instanceof ApiRequestError ? err.message : undefined });
      await mutate();
    }
  }

  async function rotate(d: DeviceResponse) {
    const ok = await confirm(
      d.connection_state === "never_connected"
        ? "A new credential is issued and the old one stops working."
        : "The firmware running now disconnects until you flash it with the new credential.",
      { title: `Rotate the credential for ${d.name}?`, confirmLabel: "Rotate credential" },
    );
    if (!ok) return;
    try {
      const result = await api.post<DeviceCreateResponse>(`/devices/${d.id}/rotate-credential`);
      setRevealed({ name: d.name, credential: result.credential });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't rotate the credential", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // ---------------------------------------------------------------- table
  const columns: DataColumn<DeviceResponse>[] = [
    {
      id: "name",
      header: "Device",
      sortable: true,
      cell: (d) => (
        <NameCell
          mono
          name={
            <Link href={`/devices/${d.id}`} className="hover:underline hover:underline-offset-[3px]">
              {d.name}
            </Link>
          }
          sub={[d.fw_version && `fw ${d.fw_version}`, d.rssi != null && `${d.rssi} dBm`].filter(Boolean).join(" · ") || d.slug}
        />
      ),
    },
    {
      id: "template",
      header: "Template",
      sortable: true,
      hideOnPhone: true,
      cell: (d) => templateName.get(d.catalog_entry_id) ?? <span className="text-ink-muted">—</span>,
    },
    {
      id: "zone",
      header: "Zone",
      sortable: true,
      hideOnPhone: true,
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

  const rowMenu = (d: DeviceResponse): DropdownMenuItem[][] => {
    const groups: DropdownMenuItem[][] = [
      [{ label: "Open device", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/devices/${d.id}`) }],
    ];
    if (canWrite) {
      groups[0].push(
        { label: "Edit", icon: <Pencil size={15} />, onClick: () => setEditId(d.id) },
        { label: "Get firmware", icon: <Wrench size={15} />, onClick: () => router.push(`/devices/${d.id}?tab=settings`) },
      );
      groups.push(
        [
          { label: "Rotate credential…", icon: <KeyRound size={15} />, onClick: () => void rotate(d) },
          {
            label: d.status === "active" ? "Disable" : "Enable",
            icon: <Power size={15} />,
            onClick: () => void setEnabled([d], d.status !== "active"),
          },
        ],
        [{ label: "Delete device…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove([d]) }],
      );
    }
    return groups;
  };

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
      <PageHeader
        title="Devices"
        description={
          devices
            ? `${plural(total, "device")}. Open a device for its readings and controls.`
            : "Open a device for its readings and controls."
        }
        actions={addAction}
      />

      {revealed && (
        <SecretReveal
          title={`New credential for ${revealed.name}`}
          fields={[
            { label: "username", value: revealed.credential.username },
            { label: "password", value: revealed.credential.password, secret: true },
          ]}
          copyLabel="Copy credential"
          onDismiss={() => setRevealed(null)}
        />
      )}

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
        <SplitView
          editorLabel="Edit device"
          onClose={() => setEditId(null)}
          editor={
            editId
              ? (mode) => (
                  <DeviceEditor
                    key={editId}
                    deviceId={editId}
                    mode={mode}
                    onClose={() => setEditId(null)}
                    expandHref={`/devices/${editId}/edit`}
                  />
                )
              : null
          }
        >
          <KpiStrip
            ariaLabel="Filter by status"
            active={list.filters.status === "all" ? null : list.filters.status}
            onSelect={(id) => list.setFilter("status", list.filters.status === id ? "all" : id)}
            items={[
              { id: "online", label: "Online", value: counts.online, sub: `of ${plural(total, "device")}`, tone: "online" },
              { id: "offline", label: "Offline", value: counts.offline, sub: "not reporting now", tone: "offline" },
              { id: "never", label: "Never connected", value: counts.never, sub: "waiting for first message", tone: "pending", shape: "hollow" },
              { id: "disabled", label: "Disabled", value: counts.disabled, sub: "not evaluated by rules", tone: "unknown", shape: "square" },
            ]}
          />

          <ListToolbar query={list.q} onQuery={list.setQuery} placeholder="Search name or template">
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
                onRowClick={(d) => router.push(`/devices/${d.id}`)}
                selection={canWrite ? { selected, onChange: setSelected, rowLabel: (d) => d.name } : undefined}
                rowMenu={rowMenu}
                rowMenuLabel={(d) => `Actions for ${d.name}`}
                rowClassName={(d) => (d.status === "disabled" ? "[&>td]:opacity-60" : undefined)}
                currentKey={editId}
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
        </SplitView>
      )}
      {dialog}
    </>
  );
}
