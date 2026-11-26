"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useNotificationSummary } from "@/hooks/useNotifications";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNavCounts } from "@/components/shell/useShellData";
import { useStarterDashboard } from "@/components/dashboards/useStarterDashboard";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { ROLE_LABEL } from "@/lib/permissions";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type SetupStatusResponse = components["schemas"]["SetupStatusResponse"];


/** Welcome (DESIGN.md §10.2): once, while the workspace has no dashboard
 * (dashboards are shared, so someone joining a workspace that has them lands
 * on one instead). What's here, then Build my dashboard, which makes the
 * first one from the workspace's devices and sets it as their default, or
 * Look around first. Either answer ends it. */
export default function WelcomePage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const build = useStarterDashboard();
  const { data: ws } = useWorkspace();
  const { role } = usePermissions();
  const { counts } = useNavCounts();
  const { summary } = useNotificationSummary();
  const { data: setup } = useApiSWR<SetupStatusResponse>("/tenants/current/setup");
  const [busy, setBusy] = useState(false);

  async function answer(next: () => Promise<string>) {
    setBusy(true);
    try {
      const path = await next();
      await api.post("/tenants/current/welcome");
      router.replace(path);
    } catch (err) {
      toast({ tone: "error", title: t("welcome.failed"), detail: err instanceof ApiRequestError ? err.message : undefined });
      setBusy(false);
    }
  }

  async function buildMine() {
    const name = t("start.overview", { name: ws?.name ?? t("start.my") });
    const id = await build(name);
    toast({ title: t("welcome.ready", { name }), detail: t("welcome.readyDetail") });
    return `/dashboards/${id}`;
  }

  if (!ws || !setup || counts.devices == null) return <LoadingSkeleton rows={3} rowClassName="h-16" />;

  const devices = counts.devices ?? 0;
  const alerts = summary?.unread ?? 0;
  const facts = [t("welcome.devices", { count: devices }), t("welcome.rules", { count: counts.rules ?? 0 }), alerts ? t("welcome.alerts", { count: alerts }) : t("welcome.noAlerts")];

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageHeader title={t("welcome.title", { name: ws.name })} description={role ? t("welcome.youreIn", { role: ROLE_LABEL[role] }) : undefined} />
      <p className="text-ink">
        <span className="text-ink-muted">{t("welcome.hereNow")} </span>
        {facts.join(" · ")}.
      </p>
      {!setup.complete && role === "viewer" && (
        <Callout tone="info" title={t("start.beingSetUp")}>
          {t("welcome.beingSetUpBody")}
        </Callout>
      )}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-section font-semibold text-ink">
          <LayoutDashboard aria-hidden size={18} className="text-accent" />
          {t("welcome.firstDashboard")}
        </h2>
        <p className="text-meta text-ink-muted">
          {role === "viewer"
            ? t("welcome.viewerBody")
            : devices > 0
              ? t("welcome.buildBody")
              : t("welcome.noDevicesBody")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {devices > 0 && role !== "viewer" && (
            <Button disabled={busy} onClick={() => void answer(buildMine)}>
              {busy ? t("welcome.building") : t("welcome.build")}
            </Button>
          )}
          <Button variant={devices > 0 && role !== "viewer" ? "ghost" : "primary"} disabled={busy} onClick={() => void answer(async () => "/devices")}>
            {t("welcome.lookAround")}
          </Button>
        </div>
      </section>
    </div>
  );
}
