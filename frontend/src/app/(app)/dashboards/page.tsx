"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, LayoutDashboard, LayoutGrid, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { DashboardPeek } from "@/components/dashboards/DashboardPeek";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { widgetSummary } from "@/lib/dashboard-summary";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Dashboards are personal (DESIGN.md §8): every member creates and edits
 * their own, so nothing here is role-gated. A row peeks; a dashboard is
 * created on /dashboards/new and opened, arranged and renamed on its page. */
export default function DashboardsPage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const list = useListState({}, { key: "updated", dir: "asc" });

  const filtered = useMemo(() => {
    const rows = (dashboards ?? []).filter((d) => matchesQuery(list.q, d.name, widgetSummary(d.layout)));
    return sortRows(rows, list.sort, (d, key) => {
      if (key === "widgets") return d.layout.length;
      if (key === "updated") return -new Date(d.updated_at).getTime();
      return d.name;
    });
  }, [dashboards, list.q, list.sort]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);
  const peek = usePeek({ rows: pageRows, rowKey: (d) => d.id, pageHref: (id) => `/dashboards/${id}`, newHref: "/dashboards/new" });

  // A copy with every widget in place, peeked; it's renamed on its page.
  async function duplicate(d: DashboardResponse) {
    try {
      const created = await api.post<DashboardResponse>("/dashboards", { name: `${d.name} copy`.slice(0, 100) });
      await api.patch(`/dashboards/${created.id}`, { layout: d.layout as unknown as Record<string, unknown>[] });
      await mutate();
      toast({ title: "Dashboard duplicated", detail: `${created.name}: ${plural(d.layout.length, "widget")} copied.` });
      peek.setPeek(created.id);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't duplicate the dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove(d: DashboardResponse) {
    const ok = await confirm(`Its ${plural(d.layout.length, "widget")} are removed. Devices and their data aren't affected.`, {
      title: `Delete ${d.name}?`,
      confirmLabel: "Delete dashboard",
    });
    if (!ok) return;
    try {
      await api.delete(`/dashboards/${d.id}`);
      await mutate();
      if (peek.peekId === d.id) peek.close();
      toast({ title: `${d.name} deleted` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const columns: DataColumn<DashboardResponse>[] = [
    {
      id: "name",
      header: "Dashboard",
      sortable: true,
      cell: (d) => (
        <NameCell
          name={
            <Link href={`/dashboards/${d.id}`} className="hover:underline hover:underline-offset-[3px]">
              {d.name}
            </Link>
          }
          sub={widgetSummary(d.layout)}
        />
      ),
    },
    { id: "widgets", header: "Widgets", sortable: true, numeric: true, cell: (d) => d.layout.length },
    {
      id: "devices",
      header: "Devices",
      numeric: true,
      hideOnPhone: true,
      cell: (d) => new Set(d.layout.map((w) => w.device_id)).size,
    },
    {
      id: "updated",
      header: "Updated",
      sortable: true,
      numeric: true,
      cell: (d) => <span className="text-ink-muted">{timeAgo(d.updated_at)}</span>,
    },
  ];

  const rowMenu = (d: DashboardResponse): DropdownMenuItem[][] => [
    [
      { label: "Open", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/dashboards/${d.id}`) },
      { label: "Edit layout", icon: <LayoutGrid size={15} />, onClick: () => router.push(`/dashboards/${d.id}?edit=1`) },
      { label: "Duplicate", icon: <Copy size={15} />, onClick: () => void duplicate(d) },
    ],
    [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(d) }],
  ];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = dashboards?.length ?? 0;
  const newButton = (
    <Link href="/dashboards/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      New dashboard
    </Link>
  );

  return (
    <>
      <PageHeader title="Dashboards" description="Your own views of live readings and controls. Only you see your dashboards." actions={newButton} />

      {error ? (
        <ErrorState
          title="Couldn't load dashboards"
          message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !dashboards ? (
        <TableSkeleton rows={3} columns={4} />
      ) : (
        <ListWithPeek
          label="Dashboard"
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? (
                  <DashboardPeek
                    dashboard={dashboards.find((d) => d.id === peek.peekId)}
                    onClose={peek.close}
                    onDuplicate={(d) => void duplicate(d)}
                    onDelete={(d) => void remove(d)}
                  />
                )
              : null
          }
        >
          {total === 0 ? (
            <FirstUse
              icon={<LayoutDashboard aria-hidden size={26} />}
              title="No dashboards yet"
              description="Create one and add value cards, charts, gauges and controls for the devices you watch most."
              action={newButton}
            />
          ) : (
            <>
              <ListToolbar query={list.q} onQuery={list.setQuery} placeholder="Search dashboards" />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun="dashboards" onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label="Dashboards"
                    columns={columns}
                    rows={pageRows}
                    rowKey={(d) => d.id}
                    sort={list.sort}
                    onSort={list.toggleSort}
                    onRowClick={peek.onRowClick}
                    onRowEnter={peek.onRowEnter}
                    rowMenu={rowMenu}
                    rowMenuLabel={(d) => `Actions for ${d.name}`}
                    currentKey={peek.peekId}
                  />
                  <TableFooter
                    shown={filtered.length}
                    total={total}
                    noun={["dashboard", "dashboards"]}
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
      {dialog}
    </>
  );
}
