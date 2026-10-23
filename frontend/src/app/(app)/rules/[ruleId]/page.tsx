"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { mutate as revalidate } from "swr";
import { Play } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { MiniStrip } from "@/components/ui/MiniStrip";
import { Callout } from "@/components/ui/Callout";
import { RuleExecutionHistory } from "@/components/rules/RuleExecutionHistory";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleActions } from "@/components/rules/useRuleActions";
import { useWideContent } from "@/components/shell/shell-context";
import { RuleVersions } from "@/components/rules/RuleVersions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { draftFromRule } from "@/lib/rule-draft";
import { RULE_STATE, ruleStateKey } from "@/lib/rule-text";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** demo G's consequence line: what saving touches. */
function consequence(rule: RuleResponse): string {
  const watched = new Set(rule.devices.filter((d) => d.role === "input").map((d) => d.device_id)).size;
  const actuators = new Set(
    [...rule.actions, ...rule.clear_actions].flatMap((a) =>
      a.type === "actuator_command" ? [`${a.device_id ?? ""}/${a.actuator}`] : [],
    ),
  ).size;
  const switches = actuators > 0 ? ` and can switch ${plural(actuators, "actuator")}` : "";
  return `Saving applies within a second. It watches ${plural(watched, "device")}${switches}.`;
}

type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];

function unhealthySummary(rule: RuleResponse): string | null {
  if (rule.health.evaluatable) return null;
  const bad = rule.health.signals.filter((s) => s.state !== "fresh");
  if (bad.length === 0) return "One or more inputs are unavailable";
  return bad
    .map((s) => `${s.metric} from ${s.device_name ?? "a device"} is ${s.state}`)
    .join("; ");
}

function primaryInputDevice(rule: RuleResponse): string | undefined {
  return (rule.devices.find((d) => d.role === "input") ?? rule.devices[0])?.device_id;
}

export default function EditRulePage() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  useWideContent();
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

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-12" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load this rule."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!rule) return <EmptyState title="Rule not found" />;

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
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumbs={[{ label: "Rules", href: "/rules" }]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-1.5">
            Rule · <Badge tone={state.tone} shape={state.shape} variant="dot" label={state.label} /> ·{" "}
            {rule.trigger.type === "schedule" ? (lastFired ? `fired ${timeAgo(lastFired)}` : "never fired") : fired ? `fired ${fired}× in 24 h` : "quiet in 24 h"}
          </span>
        }
        title={rule.name}
        description={consequence(rule)}
        actions={
          isAdmin ? (
            <>
              <Button type="button" variant="secondary" onClick={() => void actions.runNow(rule)}>
                <Play size={14} aria-hidden /> Run now…
              </Button>
              <DropdownMenu label="More actions" groups={actions.menu(rule, { where: "page", onDeleted: () => router.push("/rules") })} />
            </>
          ) : undefined
        }
      />
      {actions.dialog}

      {rule.latched && (
        <Callout tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <b className="font-medium">Latched.</b> It fired and won&rsquo;t fire again until someone resets it.
            </span>
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => void actions.resetLatch(rule)}>
                Reset latch…
              </Button>
            )}
          </span>
        </Callout>
      )}

      {unhealthy && (
        <Callout>
          <b className="font-medium">Can&rsquo;t evaluate now.</b> {unhealthy}. Missing data never fires or clears it.
        </Callout>
      )}

        {restored && (
          <Callout tone="info" className="mb-3">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Version {restored.version} is loaded. Save to make it current, or discard it.
              </span>
              <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setRestored(null)}>
                Discard
              </button>
            </span>
          </Callout>
        )}
        <RuleEditor
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
                <h2 className="text-base font-semibold text-ink">Last 24 hours</h2>
                <span className="text-[13px] text-ink-muted">{fired ? `fired ${fired}×` : "quiet"}</span>
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
            <h2 className="text-base font-semibold text-ink">Recent firings</h2>
            <RuleExecutionHistory ruleId={params.ruleId} />
          </section>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-semibold text-ink">Versions</h2>
              <span className="text-[13px] text-ink-muted">Restore loads one into the editor; nothing changes until you save.</span>
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
