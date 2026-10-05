"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes, Copy, Cpu, Pencil, Plus, Power, SquareArrowOutUpRight, Trash2 } from "lucide-react";
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
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import { SplitView } from "@/components/editor/SplitView";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function KeyChips({ keys: raw }: { keys: (string | null | undefined)[] }) {
  const keys = raw.filter((k): k is string => !!k);
  if (keys.length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {keys.slice(0, 3).map((k) => (
        <Tag key={k} mono>
          {k}
        </Tag>
      ))}
      {keys.length > 3 && <span className="text-xs text-ink-muted">+{keys.length - 3}</span>}
    </span>
  );
}

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

  // `?edit=<id>` docks the template editor beside the list (DESIGN.md §7).
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
      if (key === "updated") return -new Date(e.updated_at).getTime();
      return e.name;
    });
  }, [entries, list.filters, list.q, list.sort]);

  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  async function setEnabled(e: CatalogEntryResponse, enabled: boolean) {
    try {
      await api.patch(`/catalog/${e.id}`, { status: enabled ? "active" : "disabled" });
      await mutate();
      toast({
        title: `${e.name} ${enabled ? "enabled" : "disabled"}`,
        detail: enabled ? "Available in Add device again." : "Hidden from Add device. Existing devices keep working.",
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the template", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove(e: CatalogEntryResponse) {
    // DESIGN.md §7: delete is blocked, with an explanation and a way out, while in use.
    if (e.device_count > 0) {
      const n = e.device_count;
      const disable = e.status === "active";
      const go = await confirm(
        `${plural(n, "device uses", "devices use")} this template, so it can't be deleted. Move ${n > 1 ? "them" : "it"} to another template or delete ${n > 1 ? "them" : "it"} first${disable ? ", or disable the template so it can't be picked for new devices" : ""}.`,
        { title: `${e.name} is in use`, confirmLabel: disable ? "Disable instead" : "View devices", cancelLabel: "Close", danger: false },
      );
      if (!go) return;
      if (disable) await setEnabled(e, false);
      else router.push(`/devices?template=${e.id}`);
      return;
    }
    const ok = await confirm("No devices use it. This can't be undone.", {
      title: `Delete ${e.name}?`,
      confirmLabel: "Delete template",
    });
    if (!ok) return;
    try {
      await api.delete(`/catalog/${e.id}`);
      await mutate();
      toast({ title: `${e.name} deleted` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the template", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const columns: DataColumn<CatalogEntryResponse>[] = [
    {
      id: "name",
      header: "Template",
      sortable: true,
      cell: (e) => (
        <NameCell
          name={
            <Link href={`/templates/${e.id}`} className="hover:underline hover:underline-offset-[3px]">
              {e.name}
            </Link>
          }
          trailing={e.is_legacy ? <Tag size="sm">Legacy</Tag> : undefined}
          sub={`${plural(e.metrics.length, "metric")} · ${plural(e.actuators.length, "actuator")}`}
        />
      ),
    },
    { id: "metrics", header: "Metrics", hideOnPhone: true, cell: (e) => <KeyChips keys={e.metrics.map((m) => m.key)} /> },
    { id: "actuators", header: "Actuators", hideOnPhone: true, cell: (e) => <KeyChips keys={e.actuators.map((a) => a.key)} /> },
    { id: "devices", header: "Devices", sortable: true, numeric: true, cell: (e) => e.device_count },
    {
      id: "status",
      header: "Status",
      cell: (e) =>
        e.status === "active" ? (
          <Badge tone="online" label="Enabled" />
        ) : (
          <Badge tone="unknown" shape="square" label="Disabled" />
        ),
    },
    {
      id: "updated",
      header: "Updated",
      sortable: true,
      hideOnPhone: true,
      cell: (e) => <span className="text-ink-muted">{timeAgo(e.updated_at)}</span>,
    },
  ];

  const rowMenu = (e: CatalogEntryResponse): DropdownMenuItem[][] => {
    const groups: DropdownMenuItem[][] = [
      [
        { label: canWrite ? "Edit" : "View", icon: <Pencil size={15} />, onClick: () => setEditId(e.id) },
        { label: "Open full page", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/templates/${e.id}`) },
        { label: "View devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${e.id}`) },
      ],
    ];
    if (canWrite) {
      groups[0].push({ label: "Duplicate", icon: <Copy size={15} />, onClick: () => router.push(`/templates/new?duplicate=${e.id}`) });
      groups.push(
        [{ label: e.status === "active" ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => void setEnabled(e, e.status !== "active") }],
        [
          {
            label: "Delete…",
            icon: <Trash2 size={15} />,
            danger: true,
            hint: e.device_count ? `${plural(e.device_count, "device uses", "devices use")} it` : undefined,
            onClick: () => void remove(e),
          },
        ],
      );
    }
    return groups;
  };

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") });

  const total = entries?.length ?? 0;
  const newAction = canWrite ? (
    <Link href="/templates/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      New template
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Device templates"
        description="A template describes a kind of device: the metrics it publishes and the actuators it can switch. Every device is created from one."
        actions={newAction}
      />

      {error ? (
        <ErrorState
          title="Couldn't load device templates"
          message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !entries ? (
        <TableSkeleton rows={4} columns={5} />
      ) : total === 0 ? (
        <FirstUse
          icon={<Boxes aria-hidden size={26} />}
          title="No device templates"
          description="A template defines which metrics a kind of device reports and which actuators it has."
          action={newAction ?? undefined}
          readOnlyNote="Ask an admin to create one."
        />
      ) : (
        <SplitView
          editorLabel="Edit device template"
          onClose={() => setEditId(null)}
          editor={
            editId
              ? (mode) => (
                  <TemplateEditor
                    key={editId}
                    entryId={editId}
                    mode={mode}
                    onClose={() => setEditId(null)}
                    expandHref={`/templates/${editId}`}
                  />
                )
              : null
          }
        >
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder="Search templates or keys"
            quick={{
              label: "Status",
              value: list.filters.status,
              onChange: (v) => list.setFilter("status", v),
              options: [
                { value: "all", label: "All", count: counts.all },
                { value: "active", label: "Enabled", count: counts.active },
                { value: "disabled", label: "Disabled", count: counts.disabled },
              ],
            }}
          />
          <FilterChips chips={chips} onClearAll={list.clearAll} />
          {filtered.length === 0 ? (
            <NoResults noun="templates" onClear={list.clearAll} />
          ) : (
            <div className="flex flex-col gap-2">
              <DataTable
                label="Device templates"
                columns={columns}
                rows={pageRows}
                rowKey={(e) => e.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={(e) => setEditId(e.id)}
                rowMenu={rowMenu}
                rowMenuLabel={(e) => `Actions for ${e.name}`}
                rowClassName={(e) => (e.status === "disabled" ? "[&>td]:opacity-60" : undefined)}
                currentKey={editId}
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
        </SplitView>
      )}
      {dialog}
    </>
  );
}
