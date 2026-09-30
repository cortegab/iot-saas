"use client";

import { useMemo, useState } from "react";
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
import { NameDialog } from "@/components/ui/NameDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type Widget = components["schemas"]["Widget"];

const WIDGET_NAMES: Record<Widget["type"], [string, string]> = {
  value_card: ["value card", "value cards"],
  trend_chart: ["trend chart", "trend charts"],
  gauge: ["gauge", "gauges"],
  device_status: ["status card", "status cards"],
  actuator_control: ["control", "controls"],
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function widgetSummary(layout: Widget[]): string {
  if (layout.length === 0) return "No widgets yet";
  const byType = new Map<Widget["type"], number>();
  for (const w of layout) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
  return Array.from(byType, ([t, n]) => `${n} ${WIDGET_NAMES[t][n === 1 ? 0 : 1]}`).join(" · ");
}

/** Dashboards are personal (DESIGN.md §8): every member creates and edits
 * their own, so nothing here is role-gated. */
export default function DashboardsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const list = useListState({}, { key: "updated", dir: "asc" });
  const [renaming, setRenaming] = useState<DashboardResponse | null>(null);
  const [duplicating, setDuplicating] = useState<DashboardResponse | null>(null);
  const creating = params.get("new") === "1";

  function setCreating(open: boolean) {
    const next = new URLSearchParams(params.toString());
    if (open) next.set("new", "1");
    else next.delete("new");
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

  async function create(name: string) {
    const created = await api.post<DashboardResponse>("/dashboards", { name });
    await mutate();
    router.push(`/dashboards/${created.id}`);
  }

  async function rename(d: DashboardResponse, name: string) {
    await api.patch(`/dashboards/${d.id}`, { name });
    await mutate();
    toast({ title: "Dashboard renamed", detail: `${d.name} → ${name}` });
  }

  async function duplicate(d: DashboardResponse, name: string) {
    const created = await api.post<DashboardResponse>("/dashboards", { name });
    await api.patch(`/dashboards/${created.id}`, { layout: d.layout as unknown as Record<string, unknown>[] });
    await mutate();
    toast({ title: "Dashboard duplicated", detail: name, action: { label: "Open", onClick: () => router.push(`/dashboards/${created.id}`) } });
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
      { label: "Rename…", icon: <Pencil size={15} />, onClick: () => setRenaming(d) },
      { label: "Duplicate…", icon: <Copy size={15} />, onClick: () => setDuplicating(d) },
    ],
    [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(d) }],
  ];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = dashboards?.length ?? 0;
  const newButton = (
    <Button onClick={() => setCreating(true)}>
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
      ) : total === 0 ? (
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

      <NameDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New dashboard"
        description="Only you see this dashboard. Add widgets after it's created."
        placeholder="Greenhouse overview"
        confirmLabel="Create dashboard"
        onSubmit={create}
      />
      <NameDialog
        open={renaming != null}
        onClose={() => setRenaming(null)}
        title="Rename dashboard"
        initial={renaming?.name ?? ""}
        confirmLabel="Rename"
        onSubmit={(name) => (renaming ? rename(renaming, name) : Promise.resolve())}
      />
      <NameDialog
        open={duplicating != null}
        onClose={() => setDuplicating(null)}
        title="Duplicate dashboard"
        description="Copies every widget and its position."
        initial={duplicating ? `${duplicating.name} copy` : ""}
        confirmLabel="Duplicate"
        onSubmit={(name) => (duplicating ? duplicate(duplicating, name) : Promise.resolve())}
      />
      {dialog}
    </>
  );
}
