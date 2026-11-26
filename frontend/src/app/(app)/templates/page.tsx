"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Boxes, Copy, Cpu, Plus, Power, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
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
import { TemplatePeek } from "@/components/catalog/TemplatePeek";
import { usePeek } from "@/components/list/usePeek";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { ApiRequestError } from "@/lib/api-client";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];


/** DESIGN.md §6 catalog standard for device templates. */
export default function DeviceTemplatesPage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("templates.write");
  const { confirm, dialog } = useConfirm();
  const { data: entries, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const list = useListState({ status: "all" }, { key: "name", dir: "asc" });
  const { data: driverCatalog } = useDriverCatalog();
  const boardLabel = useMemo(() => new Map((driverCatalog?.models ?? []).map((m) => [m.id, m.label])), [driverCatalog]);


  const counts = useMemo(() => {
    const c = { all: entries?.length ?? 0, active: 0, disabled: 0 };
    for (const e of entries ?? []) c[e.status] += 1;
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const rows = (entries ?? []).filter(
      (e) =>
        (list.filters.status === "all" || e.status === list.filters.status) &&
        matchesQuery(list.q, e.name, ...e.metrics.map((m) => m.key), ...e.actuators.map((a) => a.key)),
    );
    return sortRows(rows, list.sort, (e, key) => {
      if (key === "devices") return e.device_count;
      if (key === "metrics") return e.metrics.length;
      if (key === "actuators") return e.actuators.length;
      if (key === "updated") return -new Date(e.updated_at).getTime();
      return e.name;
    });
  }, [entries, list.filters, list.q, list.sort]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);
  // A row peeks (DESIGN.md §7); a template is edited on /templates/{id}.
  const peek = usePeek({ rows: pageRows, rowKey: (e) => e.id, pageHref: (id) => `/templates/${id}`, newHref: "/templates/new" });

  async function setEnabled(e: CatalogEntryResponse, enabled: boolean) {
    try {
      await api.patch(`/catalog/${e.id}`, { status: enabled ? "active" : "disabled" });
      await mutate();
      toast({
        title: tr(enabled ? "tlist.enabledToast" : "tlist.disabledToast", { template: e.name }),
        detail: enabled ? tr("tlist.enabledDetail") : tr("tlist.disabledDetail"),
      });
    } catch (err) {
      toast({ tone: "error", title: tr("tlist.updateFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Resolves true once the template is deleted. */
  async function remove(e: CatalogEntryResponse): Promise<boolean> {
    // DESIGN.md §7: delete is blocked, with an explanation and a way out, while in use.
    if (e.device_count > 0) {
      const n = e.device_count;
      const disable = e.status === "active";
      const go = await confirm(
        tr(disable ? "tlist.inUseDisable" : "tlist.inUse", { count: n }),
        { title: tr("tpl.inUseTitle", { template: e.name }), confirmLabel: disable ? tr("tlist.disableInstead") : tr("tpl.viewDevices"), cancelLabel: tr("tpl.close"), danger: false },
      );
      if (!go) return false;
      if (disable) await setEnabled(e, false);
      else router.push(`/devices?template=${e.id}`);
      return false;
    }
    const ok = await confirm(tr("tpl.deleteBody"), {
      title: tr("tpl.deleteTitle", { template: e.name }),
      confirmLabel: tr("tpl.deleteConfirm"),
    });
    if (!ok) return false;
    try {
      await api.delete(`/catalog/${e.id}`);
      await mutate();
      toast({ title: tr("tpl.deleted", { template: e.name }) });
      return true;
    } catch (err) {
      toast({ tone: "error", title: tr("tpl.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
      return false;
    }
  }

  /** demo H: what it runs on, under the name. */
  const runsOnLine = (e: CatalogEntryResponse) =>
    e.runs_on === "generic_firmware"
      ? e.hardware
        ? tr("tlist.ourFirmwareOn", { board: boardLabel.get(e.hardware.board) ?? e.hardware.board })
        : tr("tpl.ourFirmware")
      : tr("tpl.customFirmware");

  const columns: DataColumn<CatalogEntryResponse>[] = [
    {
      id: "name",
      get header() { return tr("tlist.template"); },
      sortable: true,
      cell: (e) => (
        <NameCell
          name={
            <Link href={`/templates/${e.id}`} className="hover:underline hover:underline-offset-[3px]">
              {e.name}
            </Link>
          }
          trailing={e.is_legacy ? <Tag size="sm">{tr("tlist.legacy")}</Tag> : undefined}
          sub={runsOnLine(e)}
        />
      ),
    },
    { id: "metrics", get header() { return tr("tlist.metrics"); }, sortable: true, numeric: true, hideOnPhone: true, priority: 2, fold: (e) => tr("tlist.metricsFold", { count: e.metrics.length }), cell: (e) => e.metrics.length },
    { id: "actuators", get header() { return tr("tlist.actuators"); }, sortable: true, numeric: true, hideOnPhone: true, priority: 3, fold: (e) => tr("tlist.actuatorsFold", { count: e.actuators.length }), cell: (e) => e.actuators.length },
    { id: "devices", get header() { return tr("tlist.devices"); }, sortable: true, numeric: true, cell: (e) => tr("tpl.devices", { count: e.device_count }) },
    {
      id: "status",
      get header() { return tr("tlist.status"); },
      cell: (e) =>
        e.status === "active" ? <Badge tone="online" variant="dot" label={tr("tpl.enabled")} /> : <Badge tone="unknown" shape="square" variant="dot" label={tr("tpl.disabled")} />,
    },
    {
      id: "updated",
      get header() { return tr("tlist.updated"); },
      sortable: true,
      hideOnPhone: true,
      priority: 3,
      fold: (e) => tr("tlist.updatedFold", { ago: timeAgo(e.updated_at) }),
      cell: (e) => <span className="text-ink-muted">{timeAgo(e.updated_at)}</span>,
    },
  ];

  const rowMenu = (e: CatalogEntryResponse): DropdownMenuItem[][] => {
    const groups: DropdownMenuItem[][] = [
      [
        { label: tr("tlist.open"), icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/templates/${e.id}`) },
        { label: tr("tpl.viewDevices"), icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${e.id}`) },
        ...(e.runs_on === "generic_firmware" && e.hardware ? [{ label: tr("tpl.wiringGuide"), icon: <BookOpen size={15} />, onClick: () => router.push(`/templates/${e.id}/wiring`) }] : []),
      ],
    ];
    if (canWrite) {
      groups[0].push({ label: tr("tpl.duplicate"), icon: <Copy size={15} />, onClick: () => router.push(`/templates/new?duplicate=${e.id}`) });
      groups.push(
        [{ label: e.status === "active" ? tr("tlist.disable") : tr("tlist.enable"), icon: <Power size={15} />, onClick: () => void setEnabled(e, e.status !== "active") }],
        [
          {
            label: tr("tpl.delete"),
            icon: <Trash2 size={15} />,
            danger: true,
            hint: e.device_count ? tr("tlist.usesIt", { count: e.device_count }) : undefined,
            onClick: () => void remove(e),
          },
        ],
      );
    }
    return groups;
  };

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: tr("tlist.search", { q: list.q }), onRemove: () => list.setQuery("") });

  const total = entries?.length ?? 0;
  const newAction = canWrite ? (
    <Link href="/templates/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {tr("tlist.newTemplate")}
    </Link>
  ) : null;

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title={tr("tlist.title")}
        description={tr("tlist.description")}
        actions={!error && entries && total > 0 ? undefined : newAction}
      />

      {error ? (
        <ErrorState
          title={tr("tlist.loadFailed")}
          message={error instanceof ApiRequestError ? error.message : tr("tpl.noResponse")}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !entries ? (
        <TableSkeleton rows={4} columns={5} />
      ) : total === 0 ? (
        <FirstUse
          icon={<Boxes aria-hidden size={26} />}
          title={tr("tlist.emptyTitle")}
          description={tr("tlist.emptyBody")}
          action={newAction ?? undefined}
          readOnlyNote={tr("tlist.askAdmin")}
        />
      ) : (
        <ListWithPeek
          label={tr("tlist.peekLabel")}
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? (
                  <TemplatePeek
                    entry={entries.find((e) => e.id === peek.peekId)}
                    onClose={peek.close}
                    onToggle={(e) => void setEnabled(e, e.status !== "active")}
                    onDelete={(e) => void remove(e).then((gone) => gone && peek.close())}
                  />
                )
              : null
          }
        >
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder={tr("tlist.searchPlaceholder")}
            actions={newAction}
            quick={{
              label: tr("tlist.status"),
              value: list.filters.status,
              onChange: (v) => list.setFilter("status", v),
              options: [
                { value: "all", label: tr("tlist.all"), count: counts.all },
                { value: "active", label: tr("tpl.enabled"), count: counts.active, tone: "online", hint: tr("tlist.enabledHint") },
                { value: "disabled", label: tr("tpl.disabled"), count: counts.disabled, tone: "unknown", shape: "square", hint: tr("tlist.disabledHint") },
              ],
            }}
          />
          <FilterChips chips={chips} onClearAll={list.clearAll} />
          {filtered.length === 0 ? (
            <NoResults noun="templates" onClear={list.clearAll} />
          ) : (
            <div className="flex flex-col gap-2">
              <DataTable
                label={tr("tlist.title")}
                columns={columns}
                rows={pageRows}
                rowKey={(e) => e.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={peek.onRowClick}
                onRowEnter={peek.onRowEnter}
                rowMenu={rowMenu}
                rowMenuLabel={(e) => tr("tlist.actionsFor", { name: e.name })}
                inactive={(e) => e.status === "disabled"}
                currentKey={peek.peekId}
              />
              <TableFooter
                shown={filtered.length}
                total={total}
                noun={["template", "templates"]}
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
      {dialog}
    </>
  );
}
