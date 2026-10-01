"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { mutate as revalidate } from "swr";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Callout";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { RuleExecutionHistory } from "@/components/rules/RuleExecutionHistory";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { ResetLatchButton } from "@/components/rules/ResetLatchButton";
import { useWideContent } from "@/components/shell/shell-context";
import { RunNowButton } from "@/components/rules/RunNowButton";
import { RuleVersions } from "@/components/rules/RuleVersions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];

// DESIGN.md §9.2: Logic · Activity. Simulating lives in the editor's
// preview; versions sit under Activity.
const TABS = [
  { id: "edit", label: "Logic" },
  { id: "activity", label: "Activity" },
];
const OLD_TABS: Record<string, string> = { simulate: "edit", versions: "activity" };

function unhealthySummary(rule: RuleResponse): string | null {
  if (rule.health.evaluatable) return null;
  const bad = rule.health.signals.filter((s) => s.state !== "fresh");
  if (bad.length === 0) return "One or more input signals are unavailable.";
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
  const searchParams = useSearchParams();
  const isAdmin = useIsAdmin();
  useWideContent();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get("tab") ?? "edit";
    return OLD_TABS[t] ?? t;
  });
  const {
    data: rule,
    error,
    isLoading,
    mutate,
  } = useApiSWR<RuleResponse>(`/rules/${params.ruleId}`, { refreshInterval: 30_000 });
  const seedDevice = rule ? primaryInputDevice(rule) : undefined;
  const { data: device } = useApiSWR<DeviceResponse>(seedDevice ? `/devices/${seedDevice}` : null);
  // A version loaded into the editor by Restore; cleared once saved.
  const [restored, setRestored] = useState<RuleVersionResponse | null>(null);

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

  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    void revalidate(`/rules/${saved.id}/versions`);
    setRestored(null);
    router.push("/rules");
  }

  // Restore: the saved snapshot over the live rule (ids, devices and health
  // stay current), shown in the editor as an unsaved draft.
  const editing: RuleResponse = restored ? ({ ...rule, ...restored.snapshot } as RuleResponse) : rule;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit rule"
        subtitle={
          device ? `on ${device.name}` : rule.devices.length > 1 ? "multi-device" : undefined
        }
        back={{ href: "/rules", label: "Rules" }}
        actions={isAdmin ? <RunNowButton ruleId={params.ruleId} /> : undefined}
      />

      {unhealthySummary(rule) && (
        <Callout tone="warning">This rule can&rsquo;t evaluate right now — {unhealthySummary(rule)}.</Callout>
      )}

      {rule.latched && (
        <Callout tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>Latched — this rule fired and won&rsquo;t fire again until it&rsquo;s reset.</span>
            {isAdmin && <ResetLatchButton ruleId={params.ruleId} />}
          </span>
        </Callout>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel id="edit" active={tab}>
        {restored && (
          <Callout tone="info" className="mb-3">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Version {restored.version} is loaded into the editor. Review it, then save to make it the current version.
              </span>
              <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setRestored(null)}>
                Discard and go back to the current version
              </button>
            </span>
          </Callout>
        )}
        <RuleEditor
          key={restored ? `${rule.id}-v${restored.version}` : rule.id}
          deviceId={seedDevice}
          existing={editing}
          onSaved={onSaved}
          onCancel={() => router.push("/rules")}
        />
      </TabPanel>

      <TabPanel id="activity" active={tab}>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-ink">Recent firings</h2>
            <RuleExecutionHistory ruleId={params.ruleId} />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-ink">Versions</h2>
            <RuleVersions
              ruleId={params.ruleId}
              canRestore={isAdmin}
              onRestore={(v) => {
                setRestored(v);
                setTab("edit");
              }}
            />
          </section>
        </div>
      </TabPanel>
    </div>
  );
}
