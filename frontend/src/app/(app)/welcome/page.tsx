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

type SetupStatusResponse = components["schemas"]["SetupStatusResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Welcome (DESIGN.md §10.2): once, for someone with no dashboard in this
 * workspace yet (usually just invited). What's here, then Build my dashboard,
 * which makes one from the workspace's devices and sets it as their default,
 * or Look around first. Either answer ends it. */
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
      toast({ tone: "error", title: "Couldn't do that", detail: err instanceof ApiRequestError ? err.message : undefined });
      setBusy(false);
    }
  }

  async function buildMine() {
    const name = `${ws?.name ?? "My"} overview`;
    const id = await build(name);
    toast({ title: `${name} is ready`, detail: "It's your default dashboard. Change it any time in Edit layout." });
    return `/dashboards/${id}`;
  }

  if (!ws || !setup || counts.devices == null) return <LoadingSkeleton rows={3} rowClassName="h-16" />;

  const devices = counts.devices ?? 0;
  const alerts = summary?.unread ?? 0;
  const facts = [plural(devices, "device"), plural(counts.rules ?? 0, "rule"), alerts ? `${plural(alerts, "alert")} need attention` : "no alerts waiting"];

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageHeader title={`Welcome to ${ws.name}`} description={role ? `You're in as ${ROLE_LABEL[role]}.` : undefined} />
      <p className="text-ink">
        <span className="text-ink-muted">Here now: </span>
        {facts.join(" · ")}.
      </p>
      {!setup.complete && role === "viewer" && (
        <Callout tone="info" title="Your workspace is being set up">
          An owner or admin is still adding devices and rules. What&apos;s there already is yours to look at.
        </Callout>
      )}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-section font-semibold text-ink">
          <LayoutDashboard aria-hidden size={18} className="text-accent" />
          Your own dashboard
        </h2>
        <p className="text-meta text-ink-muted">
          {devices > 0
            ? `A chart for each device's main reading (up to 8), made for you and set as where you land. Only you see it; change it any time.`
            : "There are no devices yet, so there's nothing to chart. Look around first; you can make one later from Dashboards."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {devices > 0 && (
            <Button disabled={busy} onClick={() => void answer(buildMine)}>
              {busy ? "Building…" : "Build my dashboard"}
            </Button>
          )}
          <Button variant={devices > 0 ? "ghost" : "primary"} disabled={busy} onClick={() => void answer(async () => "/devices")}>
            Look around first
          </Button>
        </div>
      </section>
    </div>
  );
}
