"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Check, ChevronDown, Copy, LayoutDashboard, LayoutGrid, List, Pencil, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { rememberDashboard } from "@/lib/landing";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { NameDialog } from "@/components/ui/NameDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tag } from "@/components/ui/Badge";
import { AttentionStrip } from "@/components/dashboards/AttentionStrip";
import { defaultNote, useDefaultDashboard } from "@/components/dashboards/useDefaultDashboard";
import { useToast } from "@/components/ui/Toast";
import { DashboardGrid, WIDGET_LABEL } from "@/components/dashboards/DashboardGrid";
import { DashboardRange } from "@/components/dashboards/widget-common";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DEFAULT_RANGE_MS, RANGE_OPTIONS } from "@/lib/chart-range";
import { WidgetList, moveWidget } from "@/components/dashboards/WidgetList";
import { AddWidgetSheet, WidgetSheet } from "@/components/dashboards/WidgetSheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";
import { NotFound, isNotFound } from "@/components/ui/NotFound";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type Widget = components["schemas"]["Widget"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A dashboard (DESIGN.md §8, demo H): personal, viewed by default, laid out
 * in edit mode (`?edit=1`): drag by the handle, resize from the corner, click a
 * widget to change it in its sheet, add one in three steps; on a phone, a list
 * to open and reorder. Removing has an Undo. Changes save as you go. */
export default function DashboardDetailPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const defaults = useDefaultDashboard();
  // Dashboards are personal: every member edits their own.
  const canEdit = usePermissions().can("dashboards.write");
  const editing = canEdit && params.get("edit") === "1";

  const { data, error, isLoading, mutate } = useApiSWR<DashboardResponse>(`/dashboards/${dashboardId}`);
  const { data: all } = useApiSWR<DashboardResponse[]>("/dashboards");
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  // The landing's fallback when no default is set: the dashboard opened last.
  const { currentTenantId } = useAuth();
  useEffect(() => {
    if (data && currentTenantId) rememberDashboard(currentTenantId, data.id);
  }, [data, currentTenantId]);

  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [adding, setAdding] = useState(false);
  // The widget whose sheet is open (DESIGN.md §8).
  const [openId, setOpenId] = useState<string | null>(null);
  const phone = useMediaQuery("(max-width: 640px)");
  const [renaming, setRenaming] = useState(false);
  // The one range every trend widget follows (demo H header).
  const [range, setRange] = useState(DEFAULT_RANGE_MS);
  const [duplicating, setDuplicating] = useState(false);

  // Seed local state once per dashboard — not on every background SWR
  // revalidation, so an in-progress drag is never clobbered by a refetch.
  useEffect(() => {
    if (data) setWidgets(data.layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);


  function setEditing(on: boolean) {
    const q = new URLSearchParams(params.toString());
    if (on) q.set("edit", "1");
    else q.delete("edit");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Saves go out one after another: each PATCH carries the whole layout, so
  // two in flight (Remove, then Undo) could land out of order and leave the
  // older one saved.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  function saveLayout(next: Widget[]): Promise<void> {
    setWidgets(next);
    saveChain.current = saveChain.current.then(async () => {
      try {
        await api.patch(`/dashboards/${dashboardId}`, { layout: next });
        void revalidate("/dashboards");
      } catch (err) {
        toast({ tone: "error", title: "Couldn't save the layout", detail: err instanceof ApiRequestError ? err.message : undefined });
      }
    });
    return saveChain.current;
  }

  function addWidget(w: Omit<Widget, "x" | "y">) {
    if (!widgets) return;
    // y must be a real number: JSON has no Infinity, and the API's Widget.y
    // is an int, so "place at the bottom" is computed here.
    const y = widgets.length === 0 ? 0 : Math.max(...widgets.map((x) => x.y + x.h));
    void saveLayout([...widgets, { ...w, x: 0, y }]);
    toast({ title: `${WIDGET_LABEL[w.type]} added`, detail: `${devices?.find((d) => d.id === w.device_id)?.name ?? ""}${w.metric ? ` · ${w.metric}` : ""}` });
  }

  function removeWidget(id: string) {
    if (!widgets) return;
    const before = widgets;
    const gone = widgets.find((w) => w.id === id);
    void saveLayout(widgets.filter((w) => w.id !== id));
    if (gone) toast({ title: `${WIDGET_LABEL[gone.type]} removed`, action: { label: "Undo", onClick: () => void saveLayout(before) } });
  }

  /** A widget changed in its sheet: applied as you go. */
  function changeWidget(next: Widget) {
    if (!widgets) return;
    void saveLayout(widgets.map((w) => (w.id === next.id ? { ...next, x: Math.min(next.x, 12 - next.w) } : w)));
  }

  async function rename(name: string) {
    await api.patch(`/dashboards/${dashboardId}`, { name });
    await mutate();
    void revalidate("/dashboards");
    toast({ title: "Dashboard renamed", detail: name });
  }

  async function duplicate(name: string) {
    const copy = await api.post<DashboardResponse>("/dashboards", { name });
    await api.patch(`/dashboards/${copy.id}`, { layout: (widgets ?? []).map((w) => ({ ...w, id: crypto.randomUUID() })) });
    void revalidate("/dashboards");
    toast({ title: "Dashboard duplicated", detail: name });
    router.push(`/dashboards/${copy.id}`);
  }

  async function remove() {
    if (!data || !widgets) return;
    const ok = await confirm(`${defaultNote(data)}Its ${plural(widgets.length, "widget")} are removed. Devices, rules and data aren't affected.`, {
      title: `Delete ${data.name}?`,
      confirmLabel: "Delete dashboard",
    });
    if (!ok) return;
    const snapshot = { name: data.name, layout: widgets };
    try {
      await api.delete(`/dashboards/${dashboardId}`);
      void revalidate("/dashboards");
      router.replace("/dashboards");
      toast({
        title: "Dashboard deleted",
        action: {
          label: "Undo",
          onClick: () =>
            void (async () => {
              const back = await api.post<DashboardResponse>("/dashboards", { name: snapshot.name });
              await api.patch(`/dashboards/${back.id}`, { layout: snapshot.layout });
              void revalidate("/dashboards");
              router.push(`/dashboards/${back.id}`);
            })(),
        },
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // Errors first: a failed fetch never seeds `widgets`, so checking the
  // loading state first would spin forever (the old 404 bug).
  if (error) {
    if (isNotFound(error)) {
      return <NotFound noun="dashboard" href="/dashboards" list="dashboards" description="Dashboards are personal, so a teammate's link opens nothing for you." />;
    }
    return <ErrorState title="Couldn't load this dashboard" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />;
  }
  if (isLoading || !data || widgets === null) return <LoadingSkeleton rows={3} rowClassName="h-24" />;

  const switcher = (
    <DropdownMenu
      label="Switch dashboard"
      align="start"
      triggerClassName="inline-flex items-center gap-1.5 rounded-md text-left hover:text-accent"
      trigger={
        <>
          {data.name}
          <ChevronDown aria-hidden size={20} className="text-ink-muted" />
        </>
      }
      groups={[
        (all ?? []).map((d) => ({
          label: d.name,
          hint: plural(d.layout.length, "widget"),
          icon: d.id === data.id ? <Check size={15} /> : <LayoutDashboard size={15} />,
          onClick: () => router.push(`/dashboards/${d.id}`),
        })),
        [
          { label: "All dashboards", icon: <List size={15} />, onClick: () => router.push("/dashboards") },
          { label: "New dashboard…", icon: <Plus size={15} />, onClick: () => router.push("/dashboards/new") },
        ],
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={switcher}
        breadcrumbs={[{ label: "Dashboards", href: "/dashboards" }]}
        eyebrow={data.is_default ? <Tag size="sm">Default</Tag> : undefined}
        description={`${plural(widgets.length, "widget")} · live`}
        actions={
          <>
            {widgets.some((w) => w.type === "trend_chart") && (
              <SegmentedControl
                ariaLabel="Range"
                value={String(range)}
                onChange={(v) => setRange(Number(v))}
                options={RANGE_OPTIONS.map((o) => ({ value: String(o.ms), label: o.label }))}
              />
            )}
            {
          canEdit &&
          (editing ? (
            <>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus aria-hidden size={15} />
                Add widget
              </Button>
              <Button
                onClick={() => {
                  setEditing(false);
                  toast({ title: "Layout saved" });
                }}
              >
                <Check aria-hidden size={15} />
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <LayoutGrid aria-hidden size={15} />
                Edit layout
              </Button>
              <DropdownMenu
                label="More dashboard actions"
                groups={[
                  [
                    defaults.item(data),
                    { label: "Rename…", icon: <Pencil size={15} />, onClick: () => setRenaming(true) },
                    { label: "Duplicate…", icon: <Copy size={15} />, onClick: () => setDuplicating(true) },
                  ],
                  [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }],
                ]}
              />
            </>
          ))}
          </>
        }
      />

      {!editing && <AttentionStrip />}

      {editing && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-muted px-3.5 py-2.5 text-meta text-ink">
          <LayoutGrid aria-hidden size={15} className="shrink-0 text-accent" />
          <span>
            <strong>Editing layout.</strong>{" "}
            {phone
              ? "Open a widget to change it, or move it up and down. Changes save as you go."
              : "Click a widget to change what it shows and its size, or drag it by its handle and resize it from the corner. Changes save as you go."}
          </span>
        </p>
      )}

      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard aria-hidden size={26} />}
          title="No widgets yet"
          description="Add value cards, trend charts, gauges, device status and controls."
          action={
            canEdit ? (
              <Button onClick={() => (editing ? setAdding(true) : (setEditing(true), setAdding(true)))}>
                <Plus aria-hidden size={14} />
                Add widget
              </Button>
            ) : undefined
          }
        />
      ) : editing && phone ? (
        <WidgetList
          widgets={widgets}
          devices={devices ?? []}
          templates={templates ?? []}
          onOpen={setOpenId}
          onMove={(id, dir) => void saveLayout(moveWidget(widgets, id, dir))}
        />
      ) : (
        <DashboardRange.Provider value={range}>
        <DashboardGrid
          widgets={widgets}
          editing={editing}
          devices={devices}
          templates={templates}
          onLayoutChange={(updated) => void saveLayout(updated)}
          onOpenWidget={setOpenId}
          onAddWidget={() => (editing ? setAdding(true) : (setEditing(true), setAdding(true)))}
        />
        </DashboardRange.Provider>
      )}

      <WidgetSheet
        widget={widgets.find((w) => w.id === openId) ?? null}
        src={{ devices: devices ?? [], templates: templates ?? [] }}
        onChange={changeWidget}
        onRemove={removeWidget}
        onClose={() => setOpenId(null)}
      />
      <AddWidgetSheet open={adding} src={{ devices: devices ?? [], templates: templates ?? [] }} onAdd={addWidget} onClose={() => setAdding(false)} />
      <NameDialog open={renaming} onClose={() => setRenaming(false)} title="Rename dashboard" initial={data.name} confirmLabel="Rename" onSubmit={rename} />
      <NameDialog
        open={duplicating}
        onClose={() => setDuplicating(false)}
        title="Duplicate dashboard"
        description="Copies every widget and its position."
        initial={`${data.name} copy`}
        confirmLabel="Duplicate"
        onSubmit={duplicate}
      />
      {dialog}
    </div>
  );
}
