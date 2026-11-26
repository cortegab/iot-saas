"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { mutate as revalidate } from "swr";
import { Play } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useChangeToast } from "@/hooks/useChangeToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { PAGE_WITH_BAR } from "@/components/editor/save-bar";
import { MiniStrip } from "@/components/ui/MiniStrip";
import { Callout } from "@/components/ui/Callout";
import { RuleExecutionHistory } from "@/components/rules/RuleExecutionHistory";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleActions } from "@/components/rules/useRuleActions";
import { RuleVersions } from "@/components/rules/RuleVersions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiRequestError } from "@/lib/api-client";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/Toast";
import { SwitchField } from "@/components/ui/Switch";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { draftFromRule } from "@/lib/rule-draft";
import { RULE_STATE, ruleStateKey } from "@/lib/rule-text";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { NotFound, isNotFound } from "@/components/ui/NotFound";
import { tActive as t } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];


/** demo G's consequence line: what saving touches (under Basics; the
 * header's description is the rule's sentence). */
function consequence(rule: RuleResponse): string {
  const watched = new Set(rule.devices.filter((d) => d.role === "input").map((d) => d.device_id)).size;
  const actuators = new Set(
    [...rule.actions, ...rule.clear_actions].flatMap((a) =>
      a.type === "actuator_command" ? [`${a.device_id ?? ""}/${a.actuator}`] : [],
    ),
  ).size;
  const switches = actuators > 0 ? t("rules.page.switches", { count: actuators }) : "";
  return t("rules.page.consequence", { devices: t("rules.page.devices", { count: watched }), switches });
}

type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];

function unhealthySummary(rule: RuleResponse): string | null {
  if (rule.health.evaluatable) return null;
  const bad = rule.health.signals.filter((s) => s.state !== "fresh");
  if (bad.length === 0) return t("rules.page.inputsUnavailable");
  return bad
    .map((s) => t("rules.page.signalState", { metric: s.metric, device: s.device_name ?? t("rules.page.aDevice"), state: s.state }))
    .join("; ");
}

function primaryInputDevice(rule: RuleResponse): string | undefined {
  return (rule.devices.find((d) => d.role === "input") ?? rule.devices[0])?.device_id;
}

export default function EditRulePage() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const {
    data: rule,
    error,
    isLoading,
    mutate,
  } = useApiSWR<RuleResponse>(`/rules/${params.ruleId}`, { refreshInterval: 30_000 });
  const seedDevice = rule ? primaryInputDevice(rule) : undefined;
  // A version loaded into the editor by Restore; cleared once saved.
  const [restored, setRestored] = useState<RuleVersionResponse | null>(null);
  const { data: activity } = useApiSWR<RuleActivityResponse[]>("/rules/activity", { refreshInterval: 60_000 });
  const ruleActivity = activity?.find((a) => a.rule_id === params.ruleId);
  const lastFired = ruleActivity?.last_fired_at;
  const actions = useRuleActions();
  // DESIGN.md §5: a state that changes while the page is open gets a toast;
  // the header's chip and callouts carry it from then on.
  useChangeToast(rule?.id, rule ? unhealthySummary(rule) : undefined, (before, now) =>
    now && !before
      ? { tone: "warning", title: t("rules.page.cantNow"), detail: t("rules.page.cantNowDetail", { reason: now }) }
      : !now && before
        ? { tone: "success", title: t("rules.page.again"), detail: t("rules.page.againDetail") }
        : null,
  );
  useChangeToast(rule?.id, rule?.latched, (before, now) =>
    now && !before ? { tone: "warning", title: t("rules.page.latched"), detail: t("rules.page.latchedDetail") } : null,
  );

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-12" />;
  if (isNotFound(error)) return <NotFound noun="rule" href="/rules" list="rules" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : t("rules.page.loadFailed")}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!rule) return <NotFound noun="rule" href="/rules" list="rules" />;

  // The editor stays on the rule after saving (DESIGN.md §7).
  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    void revalidate(`/rules/${saved.id}`);
    void revalidate(`/rules/${saved.id}/versions`);
    void revalidate("/rules/activity");
    setRestored(null);
  }

  // Restore: the saved snapshot over the live rule (ids, devices and health
  // stay current), loaded as unsaved changes against the current version.
  const restoredDraft = restored ? draftFromRule({ ...rule, ...restored.snapshot } as RuleResponse) : undefined;

  const state = RULE_STATE[ruleStateKey(rule)];
  const fired = ruleActivity?.fired ?? 0;
  const unhealthy = unhealthySummary(rule);

  return (
    <div className={`${PAGE_WITH_BAR} gap-4`}>
      <RuleEditor
        readOnly={!isAdmin}
        header={(sentence) => (
          <>
            <PageHeader
              breadcrumbs={[{ label: t("rules.title"), href: "/rules" }]}
              eyebrow={
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <Badge tone={state.tone} shape={state.shape} variant="dot" label={state.label} /> ·{" "}
                  {rule.trigger.type === "schedule"
                    ? lastFired
                      ? t("editor.peek.firedAgo", { ago: timeAgo(lastFired) })
                      : t("editor.peek.neverFired")
                    : fired
                      ? t("editor.peek.firedLower", { count: fired })
                      : t("editor.peek.quietLower")}
                  {/* One state (Can't evaluate replaces Armed), and why, in words. */}
                  {unhealthy && <span>· {unhealthy}. Missing data never fires or clears it.</span>}
                </span>
              }
              title={rule.name}
              // The rule as a sentence (DESIGN.md §9.3): its chips edit it in place.
              description={sentence}
              actions={
                isAdmin ? (
                  <Button type="button" variant="secondary" onClick={() => void actions.runNow(rule)}>
                    <Play size={14} aria-hidden /> {t("rules.actions.runNow")}
                  </Button>
                ) : undefined
              }
              menu={
                isAdmin ? (
                  <DropdownMenu label={t("ui.moreActions")} groups={actions.menu(rule, { where: "page", onDeleted: () => router.push("/rules") })} />
                ) : undefined
              }
            />
            {actions.dialog}
            {rule.latched && (
              <Callout tone="warning" className="max-w-[760px]">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <b className="font-medium">Latched.</b> It fired and won&rsquo;t fire again until someone resets it.
                  </span>
                  {isAdmin && (
                    <Button variant="secondary" size="sm" onClick={() => void actions.resetLatch(rule)}>
                      {t("rules.page.resetLatch")}
                    </Button>
                  )}
                </span>
              </Callout>
            )}
            {restored && (
              <Callout tone="info" className="max-w-[760px]">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span>Version {restored.version} is loaded. Save to make it current, or discard it.</span>
                  <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setRestored(null)}>
                    {t("ui.discard")}
                  </button>
                </span>
              </Callout>
            )}
          </>
        )}
          consequence={consequence(rule)}
          basicsExtra={isAdmin && rule.trigger.type === "manual" ? <SceneSwitch rule={rule} onSaved={(saved) => upsertRuleInCache(saved)} /> : undefined}
          key={restored ? `${rule.id}-v${restored.version}` : rule.id}
          deviceId={seedDevice}
          existing={rule}
          initialDraft={restoredDraft}
          onSaved={onSaved}
          activity={
        <div className="flex flex-col gap-7">
          {/* demo H: the last 24 hours, wide, from 24 h ago to now. */}
          {rule.trigger.type !== "schedule" && ruleActivity && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-section font-semibold text-ink">Last 24 hours</h2>
                <span className="text-meta text-ink-muted">{fired ? `fired ${fired}×` : "quiet"}</span>
              </div>
              <MiniStrip
                variant="replay"
                cells={ruleActivity.cells}
                label={`Fired ${fired} time${fired === 1 ? "" : "s"} in the last 24 hours`}
                axis={["24 h ago", "now"]}
              />
            </section>
          )}
          <section className="flex flex-col gap-3">
            <h2 className="text-section font-semibold text-ink">Recent firings</h2>
            <RuleExecutionHistory ruleId={params.ruleId} />
          </section>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-section font-semibold text-ink">Versions</h2>
              <span className="text-meta text-ink-muted">Restore loads one into the editor; nothing changes until you save.</span>
            </div>
            <RuleVersions
              ruleId={params.ruleId}
              canRestore={isAdmin}
              onRestore={(v) => {
                // The restored editor opens on its logic, not on Activity.
                const url = new URL(window.location.href);
                url.searchParams.delete("tab");
                window.history.replaceState(window.history.state, "", url);
                setRestored(v);
              }}
            />
          </section>
        </div>
          }
        />
    </div>
  );
}

/** A manual rule as a scene (DESIGN.md §15a; ease-of-use C5): opened to
 * Viewers, it shows as a button on dashboards for everyone in the workspace. */
function SceneSwitch({ rule, onSaved }: { rule: RuleResponse; onSaved: (saved: RuleResponse) => void }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function set(allowed: boolean) {
    setBusy(true);
    try {
      const saved = await api.put<RuleResponse>(`/rules/${rule.id}/clients-can-run`, { allowed });
      onSaved(saved);
      void revalidate(`/rules/${rule.id}`);
      void revalidate("/rules");
      toast({ title: allowed ? t("rules.page.sceneNow") : t("rules.page.sceneNoMore"), detail: allowed ? t("rules.page.sceneOnHint") : undefined });
    } catch (err) {
      toast({ tone: "error", title: t("rules.page.changeFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }
  return (
    <SwitchField
      label={t("rules.page.scene")}
      checked={rule.clients_can_run ?? false}
      onChange={(v) => void set(v)}
      disabled={busy}
      onLabel={t("rules.page.sceneOn")}
      offLabel={t("rules.page.sceneOff")}
      onHint={t("rules.page.sceneOnHint")}
      offHint={t("rules.page.sceneOffHint")}
    />
  );
}
