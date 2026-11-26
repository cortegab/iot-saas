"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { actionsText } from "@/lib/rule-text";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];

/**
 * Scenes above a dashboard (DESIGN.md §15a; ease-of-use C5): every enabled
 * manual rule an admin opened to clients, as a button anyone in the workspace
 * can press. Each asks first, saying what it does, then runs it (POST
 * /rules/{id}/run; the API lets a Viewer run only these).
 */
export function ScenesRow() {
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const [running, setRunning] = useState<string | null>(null);
  const scenes = (rules ?? []).filter((r) => r.enabled && r.clients_can_run && r.trigger.type === "manual");
  if (scenes.length === 0) return null;

  async function run(rule: RuleResponse) {
    const what = actionsText(rule.actions);
    const ok = await confirm(`${what}.`, { title: t("dashboards.runTitle", { name: rule.name }), confirmLabel: t("dashboards.runConfirm"), danger: false });
    if (!ok) return;
    setRunning(rule.id);
    try {
      await api.post(`/rules/${rule.id}/run`);
      toast({ title: t("dashboards.running", { name: rule.name }), detail: what });
    } catch (err) {
      toast({ tone: "error", title: t("dashboards.runFailed", { name: rule.name }), detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setRunning(null);
    }
  }

  return (
    <section aria-label={t("dashboards.scenes")} className="flex flex-wrap items-center gap-2">
      <span className="text-meta font-medium text-ink-muted">{t("dashboards.scenes")}</span>
      {scenes.map((r) => (
        <Button key={r.id} variant="secondary" size="sm" disabled={running === r.id} onClick={() => void run(r)}>
          <Play aria-hidden size={13} />
          {r.name}
        </Button>
      ))}
      {dialog}
    </section>
  );
}
