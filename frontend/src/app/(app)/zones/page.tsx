"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Cpu, MapPin, Pencil, Plus } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { SplitView } from "@/components/editor/SplitView";
import { ZoneEditor } from "@/components/zones/ZoneEditor";
import { ApiRequestError } from "@/lib/api-client";
import { deviceStatusKey } from "@/lib/device-status";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

/** Zones (DESIGN.md §6/§8): Zone · Devices · Status. Name and notes only;
 * devices are assigned from their own settings. */
export default function ZonesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = usePermissions();
  const canWrite = can("zones.write");
  const { data: zones, error, isLoading, mutate } = useApiSWR<ZoneResponse[]>("/zones");
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const list = useListState({ show: "all" }, { key: "name", dir: "asc" });

  const editId = params.get("edit");
  function setEditId(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("edit", id);
    else next.delete("edit");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Offline count per zone, from the devices list (disabled devices don't count).
  const offline = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devices ?? []) {
      if (d.zone_id && deviceStatusKey(d) === "offline") m.set(d.zone_id, (m.get(d.zone_id) ?? 0) + 1);
    }
    return m;
  }, [devices]);

  const counts = { all: zones?.length ?? 0, used: (zones ?? []).filter((z) => z.device_count > 0).length };

  const filtered = useMemo(() => {
    const rows = (zones ?? []).filter(
      (z) =>
        (list.filters.show === "all" || (list.filters.show === "used" ? z.device_count > 0 : z.device_count === 0)) &&
        matchesQuery(list.q, z.name, z.notes),
    );
    return sortRows(rows, list.sort, (z, key) => (key === "devices" ? z.device_count : z.name));
  }, [zones, list.filters.show, list.q, list.sort]);
  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  const status = (z: ZoneResponse) => {
    if (z.device_count === 0) return <Badge tone="unknown" shape="square" label="No devices" />;
    const off = offline.get(z.id) ?? 0;
    return off ? <Badge tone="offline" label={`${off} offline`} /> : <Badge tone="online" label="All online" />;
  };

  const columns: DataColumn<ZoneResponse>[] = [
    { id: "name", header: "Zone", sortable: true, cell: (z) => <NameCell name={z.name} sub={z.notes ?? undefined} /> },
    { id: "devices", header: "Devices", sortable: true, numeric: true, cell: (z) => z.device_count },
    { id: "status", header: "Status", cell: status },
  ];

  const rowMenu = (z: ZoneResponse): DropdownMenuItem[][] => [
    [
      { label: canWrite ? "Edit" : "View", icon: <Pencil size={15} />, onClick: () => setEditId(z.id) },
      { label: "View its devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${z.id}`) },
    ],
  ];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = zones?.length ?? 0;
  const newButton = canWrite ? (
    <Button onClick={() => setEditId("new")}>
      <Plus aria-hidden size={15} />
      New zone
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Zones" description="Places devices are installed in. Filter devices by zone and see each place's status at a glance." actions={newButton} />
      {error ? (
        <ErrorState title="Couldn't load zones" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      ) : isLoading || !zones ? (
        <TableSkeleton rows={4} columns={3} />
      ) : (
        <SplitView
          editorLabel={editId === "new" ? "New zone" : "Edit zone"}
          onClose={() => setEditId(null)}
          editor={
            editId
              ? (mode) => (
                  <ZoneEditor
                    key={editId}
                    zoneId={editId === "new" ? null : editId}
                    mode={mode}
                    onClose={() => setEditId(null)}
                    onCreated={(id) => setEditId(id)}
                  />
                )
              : null
          }
        >
          {total === 0 ? (
            <FirstUse
              icon={<MapPin aria-hidden size={26} />}
              title="No zones yet"
              description="Create zones for the places your devices live — a greenhouse bay, a cold room, a pump house — then pick one in each device's settings."
              action={newButton ?? undefined}
              readOnlyNote="Ask an admin to create zones."
            />
          ) : (
            <>
              <ListToolbar
                query={list.q}
                onQuery={list.setQuery}
                placeholder="Search zones"
                quick={{
                  label: "Show",
                  value: list.filters.show,
                  onChange: (v) => list.setFilter("show", v),
                  options: [
                    { value: "all", label: "All", count: counts.all },
                    { value: "used", label: "In use", count: counts.used },
                    { value: "empty", label: "Empty", count: counts.all - counts.used },
                  ],
                }}
              />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun="zones" onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label="Zones"
                    columns={columns}
                    rows={pageRows}
                    rowKey={(z) => z.id}
                    sort={list.sort}
                    onSort={list.toggleSort}
                    onRowClick={(z) => setEditId(z.id)}
                    rowMenu={rowMenu}
                    rowMenuLabel={(z) => `Actions for ${z.name}`}
                    currentKey={editId}
                  />
                  <TableFooter
                    shown={filtered.length}
                    total={total}
                    noun={["zone", "zones"]}
                    page={page}
                    pageCount={pageCount}
                    pageSize={list.pageSize}
                    onPage={list.setPage}
                    onPageSize={list.setPageSize}
                  />
                </div>
              )}
            </>
          )}
        </SplitView>
      )}
    </>
  );
}
