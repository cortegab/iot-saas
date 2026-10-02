"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Copy, LayoutGrid, Link2, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import { widgetSummary } from "@/lib/dashboard-summary";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

interface DashboardDraft {
  name: string;
}

const DIFF: DiffField<DashboardDraft>[] = [{ label: "Name", get: (d) => d.name.trim() }];
const BLANK: DashboardDraft = { name: "" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A dashboard's details, docked beside the list like every catalog editor
 * (DESIGN.md §7/§8). Only the name lives here; widgets are added, moved and
 * removed in place on the grid. Dashboards are personal, so nothing is
 * role-gated. */
export function DashboardEditor({
  dashboardId,
  mode,
  onClose,
  onCreated,
  onDuplicate,
}: {
  /** null = new dashboard. */
  dashboardId: string | null;
  mode: EditorMode;
  onClose?: () => void;
  onCreated?: (id: string) => void;
  onDuplicate?: (d: DashboardResponse) => void;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: dashboards, error, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");
  const dashboard = dashboardId ? dashboards?.find((d) => d.id === dashboardId) : undefined;

  const isNew = dashboardId == null;
  const source = useMemo<DashboardDraft | null>(() => (isNew ? BLANK : dashboard ? { name: dashboard.name } : null), [isNew, dashboard]);
  const validate = useCallback((d: DashboardDraft): Validation => {
    const errors: Record<string, string> = {};
    const name = d.name.trim();
    if (!name) errors["dashboard.name"] = "Give the dashboard a name.";
    else if (name.length > 100) errors["dashboard.name"] = "Keep the name to 100 characters.";
    return { errors };
  }, []);
  const editor = useRecordEditor({ source, isNew, validate });
  const { confirmLeave, dialog: guardDialog } = useUnsavedGuard(editor.dirty, dashboard?.name ?? "this dashboard");

  const close = useCallback(async () => {
    if (await confirmLeave()) onClose?.();
  }, [confirmLeave, onClose]);

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor
      .save(async (d) => {
        const name = d.name.trim();
        try {
          if (isNew) {
            const created = await api.post<DashboardResponse>("/dashboards", { name });
            await mutate();
            toast({
              title: "Dashboard created",
              detail: created.name,
              action: { label: "Add widgets", onClick: () => router.push(`/dashboards/${created.id}?edit=1`) },
            });
            onCreated?.(created.id);
          } else {
            await api.patch(`/dashboards/${dashboardId}`, { name });
            await mutate();
            void revalidate(`/dashboards/${dashboardId}`);
            toast({ title: "Dashboard saved", detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
          }
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function remove() {
    if (!dashboard) return;
    const ok = await confirm(`Its ${plural(dashboard.layout.length, "widget")} are removed. Devices and their data aren't affected.`, {
      title: `Delete ${dashboard.name}?`,
      confirmLabel: "Delete dashboard",
    });
    if (!ok) return;
    try {
      await api.delete(`/dashboards/${dashboard.id}`);
      await mutate();
      toast({ title: `${dashboard.name} deleted` });
      onClose?.();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState title="Couldn't load this dashboard" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (dashboards && !isNew && !dashboard) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <ErrorState title="This dashboard doesn't exist" message="It may have been deleted." />
        {onClose && (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    );
  }
  const d = editor.draft;
  if (!d) {
    return (
      <div className="p-5">
        <LoadingSkeleton rows={2} rowClassName="h-10" />
      </div>
    );
  }

  const widgets = dashboard?.layout.length ?? 0;
  return (
    <>
      <EditorFrame
        mode={mode}
        noun="dashboard"
        title={d.name.trim() || (isNew ? "New dashboard" : dashboard!.name)}
        eyebrow={<>Dashboard{!isNew && <span>· {plural(widgets, "widget")}</span>}</>}
        consequence={isNew ? "Only you see it. Add widgets on the dashboard once it exists." : "Only you see this dashboard. Widgets are arranged on the dashboard itself."}
        sections={[{ id: "dashboard", label: "Dashboard" }]}
        status={editor}
        saveLabel={isNew ? "Create dashboard" : "Save"}
        onSave={onSave}
        onDiscard={editor.discard}
        onClose={onClose ? () => void close() : undefined}
        menu={
          isNew || !dashboard
            ? undefined
            : [
                [
                  { label: "Open", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/dashboards/${dashboard.id}`) },
                  { label: "Edit layout", icon: <LayoutGrid size={15} />, onClick: () => router.push(`/dashboards/${dashboard.id}?edit=1`) },
                  ...(onDuplicate ? [{ label: "Duplicate", icon: <Copy size={15} />, onClick: () => onDuplicate(dashboard) }] : []),
                  {
                    label: "Copy link",
                    icon: <Link2 size={15} />,
                    onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/dashboards/${dashboard.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
                  },
                ],
                [{ label: "Delete dashboard…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }],
              ]
        }
      >
        <EditorSection id="dashboard" title="Dashboard">
          <Field label="Name" error={editor.errorFor("dashboard.name")}>
            <Input value={d.name} placeholder="e.g. Greenhouse overview" onChange={(e) => editor.set({ ...d, name: e.target.value })} onBlur={() => editor.touch("dashboard.name")} />
          </Field>
          {dashboard && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-ink-muted">{widgetSummary(dashboard.layout)}.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/dashboards/${dashboard.id}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  <SquareArrowOutUpRight aria-hidden size={14} /> Open
                </Link>
                <Link href={`/dashboards/${dashboard.id}?edit=1`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  <LayoutGrid aria-hidden size={14} /> {widgets ? "Edit layout" : "Add widgets"}
                </Link>
              </div>
            </div>
          )}
        </EditorSection>
      </EditorFrame>
      {dialog}
      {guardDialog}
    </>
  );
}
