"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, LayoutDashboard, LayoutGrid, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
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
import { defaultNote, useDefaultDashboard } from "@/components/dashboards/useDefaultDashboard";
import { Tag } from "@/components/ui/Badge";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { widgetSummary } from "@/lib/dashboard-summary";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type DashboardResponse = components["schemas"]["DashboardResponse"];


/** Dashboards are shared by the workspace (DESIGN.md §8): every member sees
 * all of them and, until permissions by role are decided, may change them. A row peeks; a dashboard is
 * created on /dashboards/new and opened, arranged and renamed on its page. */
export default function DashboardsPage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const list = useListState({}, { key: "updated", dir: "asc" });
  const defaults = useDefaultDashboard();

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
      toast({ title: tr("dashboards.duplicatedToast"), detail: tr("lists.dashboards.duplicatedDetail", { name: created.name, widgets: tr("app.screens.widgets", { count: d.layout.length }) }) });
      peek.setPeek(created.id);
    } catch (err) {
      toast({ tone: "error", title: tr("lists.dashboards.duplicateFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove(d: DashboardResponse) {
    const ok = await confirm(`${defaultNote(d)}${tr("lists.dashboards.deleteBody")}`, {
      title: tr("dashboards.deleteTitle", { name: d.name }),
      confirmLabel: tr("dashboards.deleteConfirm"),
    });
    if (!ok) return;
    try {
      await api.delete(`/dashboards/${d.id}`);
      await mutate();
      if (peek.peekId === d.id) peek.close();
      toast({ title: `${d.name} deleted` });
    } catch (err) {
      toast({ tone: "error", title: tr("dashboards.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const columns: DataColumn<DashboardResponse>[] = [
    {
      id: "name",
      header: tr("lists.dashboards.dashboard"),
      sortable: true,
      cell: (d) => (
        <NameCell
          name={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link href={`/dashboards/${d.id}`} className="hover:underline hover:underline-offset-[3px]">
                {d.name}
              </Link>
              {d.is_default && <Tag size="sm">Default</Tag>}
            </span>
          }
          sub={widgetSummary(d.layout)}
        />
      ),
    },
    { id: "widgets", header: tr("lists.dashboards.widgets"), sortable: true, numeric: true, cell: (d) => d.layout.length },
    {
      id: "devices",
      header: tr("lists.dashboards.devices"),
      numeric: true,
      hideOnPhone: true,
      cell: (d) => new Set(d.layout.map((w) => w.device_id)).size,
    },
    {
      id: "updated",
      header: tr("lists.dashboards.updated"),
      sortable: true,
      numeric: true,
      cell: (d) => <span className="text-ink-muted">{timeAgo(d.updated_at)}</span>,
    },
  ];

  // Owners and admins change dashboards; viewers open them and pick their
  // own default (DESIGN.md §8).
  const canWrite = usePermissions().can("dashboards.write");
  const rowMenu = (d: DashboardResponse): DropdownMenuItem[][] =>
    canWrite
      ? [
          [
            { label: tr("lists.dashboards.open"), icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/dashboards/${d.id}`) },
            { label: tr("lists.dashboards.editLayout"), icon: <LayoutGrid size={15} />, onClick: () => router.push(`/dashboards/${d.id}?edit=1`) },
            defaults.item(d),
            { label: tr("lists.dashboards.duplicate"), icon: <Copy size={15} />, onClick: () => void duplicate(d) },
          ],
          [{ label: tr("dashboards.deleteDots"), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(d) }],
        ]
      : [[{ label: tr("lists.dashboards.open"), icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/dashboards/${d.id}`) }, defaults.item(d)]];

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = dashboards?.length ?? 0;
  const newButton = canWrite ? (
    <Link href="/dashboards/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {tr("start.newDashboard")}
    </Link>
  ) : undefined;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title={tr("dashboards.title")}
        description={tr("lists.dashboards.description")}
        actions={!error && dashboards && total > 0 ? undefined : newButton}
      />

      {error ? (
        <ErrorState
          title={tr("lists.dashboards.loadFailed")}
          message={error instanceof ApiRequestError ? error.message : tr("devices.apiDown")}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !dashboards ? (
        <TableSkeleton rows={3} columns={4} />
      ) : (
        <ListWithPeek
          label={tr("lists.dashboards.dashboard")}
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
              title={tr("lists.dashboards.emptyTitle")}
              description={tr("lists.dashboards.emptyBody")}
              action={newButton}
              readOnlyNote={tr("lists.dashboards.askAdmin")}
            />
          ) : (
            <>
              <ListToolbar query={list.q} onQuery={list.setQuery} placeholder={tr("lists.dashboards.search")} actions={newButton} />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun={tr("lists.dashboards.nounMany")} onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label={tr("dashboards.title")}
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
                    noun={[tr("lists.dashboards.nounOne"), tr("lists.dashboards.nounMany")]}
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
