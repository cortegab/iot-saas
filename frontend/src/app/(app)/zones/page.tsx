"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cpu, MapPin, Plus, SquareArrowOutUpRight } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { ZonePeek } from "@/components/zones/ZonePeek";
import { useDeleteZone } from "@/components/zones/useDeleteZone";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { deviceStatusKey } from "@/lib/device-status";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type ZoneResponse = components["schemas"]["ZoneResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

/** Zones (DESIGN.md §6/§8): Zone · Devices · Status. A row peeks; the
 * zone is edited on its page. Devices are assigned from their own settings. */
export default function ZonesPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const canWrite = can("zones.write");
  const { data: zones, error, isLoading, mutate } = useApiSWR<ZoneResponse[]>("/zones");
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const list = useListState({ show: "all" }, { key: "name", dir: "asc" });

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
  const peek = usePeek({ rows: pageRows, rowKey: (z) => z.id, pageHref: (id) => `/zones/${id}`, newHref: "/zones/new" });
  const deleteZone = useDeleteZone(peek.close);

  const status = (z: ZoneResponse) => {
    if (z.device_count === 0) return <Badge tone="unknown" shape="square" label={tr("zone.noDevices")} />;
    const off = offline.get(z.id) ?? 0;
    return off ? <Badge tone="offline" variant="dot" label={tr("zone.offline", { count: off })} /> : <Badge tone="online" variant="dot" label={tr("zone.allReporting")} />;
  };

  const columns: DataColumn<ZoneResponse>[] = [
    {
      id: "name",
      get header() { return tr("zone.zone"); },
      sortable: true,
      cell: (z) => (
        <NameCell
          name={
            <Link href={`/zones/${z.id}`} className="hover:underline hover:underline-offset-[3px]">
              {z.name}
            </Link>
          }
          sub={z.notes || tr("zone.noNotes")}
        />
      ),
    },
    { id: "devices", get header() { return tr("zone.devices"); }, sortable: true, numeric: true, cell: (z) => tr("zone.deviceCount", { count: z.device_count }) },
    { id: "status", get header() { return tr("zone.status"); }, cell: status },
  ];

  const rowMenu = (z: ZoneResponse): DropdownMenuItem[][] => [
    [
      { label: tr("zone.open"), icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/zones/${z.id}`) },
      { label: tr("zone.viewDevices"), icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${z.id}`) },
    ],
    ...(canWrite ? [[deleteZone.menuItem(z)]] : []),
  ];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: tr("zone.searchChip", { q: list.q }), onRemove: () => list.setQuery("") }] : [];
  const total = zones?.length ?? 0;
  const newButton = canWrite ? (
    <Link href="/zones/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {tr("zone.newZone")}
    </Link>
  ) : null;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader inline title={tr("zone.title")} description={tr("zone.description")} actions={!error && zones && total > 0 ? undefined : newButton} />
      {error ? (
        <ErrorState title={tr("zone.loadListFailed")} message={error instanceof ApiRequestError ? error.message : tr("zone.noResponse")} onRetry={() => void mutate()} />
      ) : isLoading || !zones ? (
        <TableSkeleton rows={4} columns={3} />
      ) : (
        <ListWithPeek
          label={tr("zone.zone")}
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? (
                  <ZonePeek
                    zone={zones.find((z) => z.id === peek.peekId)}
                    offline={offline.get(peek.peekId!) ?? 0}
                    onClose={peek.close}
                  />
                )
              : null
          }
        >
          {total === 0 ? (
            <FirstUse
              icon={<MapPin aria-hidden size={26} />}
              title={tr("zone.emptyTitle")}
              description={tr("zone.emptyBody")}
              action={newButton ?? undefined}
              readOnlyNote={tr("zone.askAdmin")}
            />
          ) : (
            <>
              <ListToolbar
                query={list.q}
                onQuery={list.setQuery}
                placeholder={tr("zone.search")}
                actions={newButton}
                quick={{
                  label: tr("zone.show"),
                  value: list.filters.show,
                  onChange: (v) => list.setFilter("show", v),
                  options: [
                    { value: "all", label: tr("zone.all"), count: counts.all },
                    { value: "used", label: tr("zone.inUse"), count: counts.used },
                    { value: "empty", label: tr("zone.empty"), count: counts.all - counts.used },
                  ],
                }}
              />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun="zones" onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label={tr("zone.title")}
                    columns={columns}
                    rows={pageRows}
                    rowKey={(z) => z.id}
                    sort={list.sort}
                    onSort={list.toggleSort}
                    onRowClick={peek.onRowClick}
                    onRowEnter={peek.onRowEnter}
                    rowMenu={rowMenu}
                    rowMenuLabel={(z) => tr("zone.actionsFor", { name: z.name })}
                    currentKey={peek.peekId}
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
        </ListWithPeek>
      )}
      {deleteZone.dialog}
    </>
  );
}
