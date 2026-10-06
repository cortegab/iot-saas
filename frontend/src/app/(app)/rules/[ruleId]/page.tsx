"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { mutate as revalidate } from "swr";
import { Copy, Play, Trash2, X } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
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
import { RuleVersions } from "@/components/rules/RuleVersions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { draftFromRule, draftToRequest } from "@/lib/rule-draft";
import { ruleStateKey, type RuleStateKey } from "@/lib/rule-text";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const STATE: Record<RuleStateKey, { label: string; tone: "online" | "pending" | "unknown"; shape: "solid" | "square" }> = {
  armed: { label: "Armed", tone: "online", shape: "solid" },
  latched: { label: "Latched", tone: "pending", shape: "square" },
  disabled: { label: "Disabled", tone: "unknown", shape: "square" },
};

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
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data: activity } = useApiSWR<RuleActivityResponse[]>("/rules/activity", { refreshInterval: 60_000 });
  const lastFired = activity?.find((a) => a.rule_id === params.ruleId)?.last_fired_at;

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
  const current = rule;

  // A copy starts disabled: two live rules on the same actuator fight.
  async function duplicate() {
    try {
      const body = { ...draftToRequest(draftFromRule(current)), name: `Copy of ${current.name}`, enabled: false };
      const copy = await api.post<RuleResponse>("/rules", body);
      upsertRuleInCache(copy);
      toast({ title: `${copy.name} created`, detail: "It starts disabled. Enable it when it's ready." });
      router.push(`/rules/${copy.id}`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't duplicate the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // Run now bypasses the for_duration hold and can drive an actuator at once.
  async function runNow() {
    const ok = await confirm(
      "Evaluate this rule right now and run its actions if the condition is met? This can command a device immediately.",
      { title: `Run ${current.name} now?`, confirmLabel: "Run now" },
    );
    if (!ok) return;
    try {
      await api.post(`/rules/${current.id}/run`, {});
      toast({ title: "Run queued", detail: "Check Activity in a moment." });
      setTimeout(() => void revalidate(`/rules/${current.id}/executions`), 1500);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't run this rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove() {
    const ok = await confirm(
      "It stops evaluating immediately. Actuators keep their current state. This can't be undone; to pause it instead, disable it.",
      { title: `Delete ${current.name}?`, confirmLabel: "Delete rule" },
    );
    if (!ok) return;
    try {
      await api.delete(`/rules/${current.id}`);
      for (const d of current.devices) void revalidate(`/devices/${d.device_id}/rules`);
      void revalidate("/rules");
      toast({ title: `${current.name} deleted` });
      router.push("/rules");
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const menu: DropdownMenuItem[][] = [
    [{ label: "Run now…", icon: <Play size={15} />, onClick: () => void runNow() }],
    [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }],
  ];
  const state = STATE[ruleStateKey(rule)];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumbs={[{ label: "Rules", href: "/rules" }, { label: rule.name }]}
        eyebrow="Rule ·"
        status={
          <>
            <Badge tone={state.tone} shape={state.shape} label={state.label} />
            <span>{lastFired ? `Fired ${timeAgo(lastFired)}` : "Never fired"}</span>
          </>
        }
        title={rule.name}
        description={consequence(rule)}
        meta={device && rule.devices.length === 1 ? <span>on <b>{device.name}</b></span> : undefined}
        actions={
          <>
            {isAdmin && (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => void duplicate()}>
                  <Copy size={14} aria-hidden /> Duplicate
                </Button>
                <DropdownMenu label="More rule actions" groups={menu} />
              </>
            )}
            <Link href="/rules" aria-label="Close" className={buttonClassName({ variant: "ghost", size: "sm" })}>
              <X size={16} aria-hidden />
            </Link>
          </>
        }
      />
      {dialog}

      {unhealthySummary(rule) && (
        <Callout tone="warning">This rule can&rsquo;t evaluate right now — {unhealthySummary(rule)}.</Callout>
      )}

      {rule.latched && (
        <Callout tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>Latched — this rule fired and won&rsquo;t fire again until it&rsquo;s reset.</span>
            {isAdmin && <ResetLatchButton rule={rule} />}
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
