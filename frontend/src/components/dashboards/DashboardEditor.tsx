"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

interface DashboardDraft {
  name: string;
}

/** New dashboard (/dashboards/new, DESIGN.md §7/§8): a name, then straight
 * to the dashboard in Edit layout to add widgets. An existing dashboard is
 * renamed and arranged on its own page. Dashboards are personal, so nothing
 * is role-gated. */
export function DashboardEditor() {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const source = useMemo<DashboardDraft>(() => ({ name: "" }), []);
  const validate = useCallback((d: DashboardDraft): Validation => {
    const errors: Record<string, string> = {};
    const name = d.name.trim();
    if (!name) errors["dashboard.name"] = "Give the dashboard a name.";
    else if (name.length > 100) errors["dashboard.name"] = "Keep the name to 100 characters.";
    return { errors };
  }, []);
  const editor = useRecordEditor({ source, isNew: true, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, "this dashboard");

  async function onSave(): Promise<boolean> {
    return editor
      .save(async (d) => {
        try {
          const created = await api.post<DashboardResponse>("/dashboards", { name: d.name.trim() });
          void revalidate("/dashboards");
          toast({ title: "Dashboard created", detail: "Add widgets: value cards, charts, gauges and controls." });
          router.replace(`/dashboards/${created.id}?edit=1`);
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  const d = editor.draft;
  if (!d) return null;
  return (
    <>
      <EditorFrame
        mode="page"
        noun="dashboard"
        title={d.name.trim() || "New dashboard"}
        eyebrow="Dashboard"
        consequence="Only you see it. Next you add widgets for the devices you watch most."
        sections={[{ id: "dashboard", label: "Dashboard" }]}
        status={editor}
        saveLabel="Create dashboard"
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <EditorSection id="dashboard" title="Dashboard">
          <Field label="Name" error={editor.errorFor("dashboard.name")}>
            <Input autoFocus value={d.name} placeholder="e.g. Greenhouse overview" onChange={(e) => editor.set({ ...d, name: e.target.value })} onBlur={() => editor.touch("dashboard.name")} />
          </Field>
        </EditorSection>
      </EditorFrame>
      {guardDialog}
    </>
  );
}
