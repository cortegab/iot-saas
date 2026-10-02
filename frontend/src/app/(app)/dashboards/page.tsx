"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Copy, LayoutDashboard, LayoutGrid, Pencil, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
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
import { SplitView } from "@/components/editor/SplitView";
import { DashboardEditor } from "@/components/dashboards/DashboardEditor";
import { ApiRequestError } from "@/lib/api-client";
import { widgetSummary } from "@/lib/dashboard-summary";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Dashboards are personal (DESIGN.md §8): every member creates and edits
 * their own, so nothing here is role-gated. New and Edit details open the
 * docked editor (`?edit=new` / `?edit=<id>`), as on every catalog; a row
 * opens the dashboard itself. */
export default function DashboardsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const list = useListState({}, { key: "updated", dir: "asc" });

  const editId = params.get("edit");
  function setEditId(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("edit", id);
    else next.delete("edit");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const filtered = useMemo(() => {
    const rows = (dashboards ?? []).filter((d) => matchesQuery(list.q, d.name, widgetSummary(d.layout)));
    return sortRows(rows, list.sort, (d, key) => {
      if (key === "widgets") return d.layout.length;
      if (key === "updated") return -new Date(d.updated_at).getTime();
      return d.name;
    });
  }, [dashboards, list.q, list.sort]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  // A copy with every widget in place, docked so it can be renamed.
  async function duplicate(d: DashboardResponse) {
    try {
      const created = await api.post<DashboardResponse>("/dashboards", { name: `${d.name} copy`.slice(0, 100) });
      await api.patch(`/dashboards/${created.id}`, { layout: d.layout as unknown as Record<string, unknown>[] });
      await mutate();
      toast({ title: "Dashboard duplicated", detail: `${created.name}: ${plural(d.layout.length, "widget")} copied.` });
      setEditId(created.id);
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
      if (editId === d.id) setEditId(null);
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
      { label: "Edit details", icon: <Pencil size={15} />, onClick: () => setEditId(d.id) },
      { label: "Duplicate", icon: <Copy size={15} />, onClick: () => void duplicate(d) },
    ],
    [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(d) }],
  ];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = dashboards?.length ?? 0;
  const newButton = (
    <Button onClick={() => setEditId("new")}>
      <Plus aria-hidden size={15} />
      New dashboard
    </Button>
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
        <SplitView
          editorLabel={editId === "new" ? "New dashboard" : "Edit dashboard"}
          onClose={() => setEditId(null)}
          editor={
            editId
              ? (mode) => (
                  <DashboardEditor
                    key={editId}
                    dashboardId={editId === "new" ? null : editId}
                    mode={mode}
                    onClose={() => setEditId(null)}
                    onCreated={(id) => setEditId(id)}
                    onDuplicate={(d) => void duplicate(d)}
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
                    onRowClick={(d) => router.push(`/dashboards/${d.id}`)}
                    rowMenu={rowMenu}
                    rowMenuLabel={(d) => `Actions for ${d.name}`}
                    currentKey={editId}
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
        </SplitView>
      )}
      {dialog}
    </>
  );
}
