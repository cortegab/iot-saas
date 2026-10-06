"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Copy, Link2, Pencil, Play, Power, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { draftFromRule, draftToRequest } from "@/lib/rule-draft";
import { actionsText, ruleStateKey, triggerText, type RuleStateKey } from "@/lib/rule-text";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const STATE: Record<RuleStateKey, { label: string; tone: "online" | "pending" | "unknown"; shape: "solid" | "square" }> = {
  armed: { label: "Armed", tone: "online", shape: "solid" },
  latched: { label: "Latched", tone: "pending", shape: "square" },
  disabled: { label: "Disabled", tone: "unknown", shape: "square" },
};

/** A rule at a glance: what it watches and does, its last day, and whether it
 * shares an actuator. It's edited on /rules/{id}. */
export function RulePeek({
  rule,
  activity,
  shares,
  onClose,
  onToggle,
  onDelete,
}: {
  rule: RuleResponse | undefined;
  activity: RuleActivityResponse | undefined;
  /** Actuators another enabled rule also drives. */
  shares: string[] | undefined;
  onClose: () => void;
  onToggle: (r: RuleResponse) => void;
  onDelete: (r: RuleResponse) => void;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("rules.write");
  const { confirm, dialog } = useConfirm();
  if (!rule) return <PeekPlaceholder noun="rule" missing onClose={onClose} />;
  const r = rule;

  async function runNow() {
    const ok = await confirm("Evaluate this rule right now and run its actions if the condition is met? This can command a device immediately.", {
      title: `Run ${r.name} now?`,
      confirmLabel: "Run now",
    });
    if (!ok) return;
    try {
      await api.post(`/rules/${r.id}/run`, {});
      toast({ title: "Run queued", detail: "Check its Activity in a moment." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't run this rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // A copy starts disabled: two live rules on the same actuator fight.
  async function duplicate() {
    try {
      const copy = await api.post<RuleResponse>("/rules", { ...draftToRequest(draftFromRule(r)), name: `Copy of ${r.name}`, enabled: false });
      upsertRuleInCache(copy);
      void revalidate("/rules");
      toast({ title: `${copy.name} created`, detail: "It starts disabled. Enable it when it's ready." });
      router.push(`/rules/${copy.id}`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't duplicate the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const state = STATE[ruleStateKey(r)];
  const devices = Array.from(new Map(r.devices.map((d) => [d.device_id, d.device_name ?? "Unnamed device"])));
  const cells: StripCell[] = activity ? [...activity.cells] : [];
  if (r.enabled && !r.health.evaluatable && cells.length > 0 && cells[cells.length - 1] === "idle") cells[cells.length - 1] = "unknown";

  const menu: DropdownMenuItem[][] = [
    [
      {
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/rules/${r.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      },
      ...(canWrite ? [{ label: "Duplicate", icon: <Copy size={15} />, onClick: () => void duplicate() }] : []),
    ],
    ...(canWrite
      ? [
          [
            { label: "Run now…", icon: <Play size={15} />, onClick: () => void runNow() },
            { label: r.enabled ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => onToggle(r) },
          ],
          [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => onDelete(r) }],
        ]
      : []),
  ];

  return (
    <>
      <PeekFrame
        noun="rule"
        title={r.name}
        eyebrow={
          <>
            Rule <Badge tone={state.tone} shape={state.shape} label={state.label} />
            {r.enabled && !r.health.evaluatable && <Tag tone="warn">Can&apos;t evaluate</Tag>}
          </>
        }
        description={
          <>
            When <code className="font-mono text-[12.5px] text-ink">{triggerText(r)}</code>, {actionsText(r.actions)}.
          </>
        }
        facts={[
          ["Last fired", r.trigger.type === "schedule" ? null : activity?.last_fired_at ? timeAgo(activity.last_fired_at) : "Never"],
          [
            "Devices",
            devices.length ? (
              <span className="flex flex-col gap-0.5">
                {devices.map(([id, name]) => (
                  <Link key={id} href={`/devices/${id}`} className="font-mono text-[13px] text-accent hover:underline">
                    {name}
                  </Link>
                ))}
              </span>
            ) : (
              "None"
            ),
          ],
          [
            "Shares",
            shares?.length ? (
              <span className="flex flex-wrap gap-1">
                {shares.map((a) => (
                  <Tag key={a} tone="warn" size="sm">
                    {a}
                  </Tag>
                ))}
              </span>
            ) : null,
          ],
        ]}
        primary={
          <Link href={`/rules/${r.id}`} className={buttonClassName({ size: "sm" })}>
            <Pencil aria-hidden size={14} /> {canWrite ? "Edit rule" : "View rule"}
          </Link>
        }
        menu={menu}
        onClose={onClose}
      >
        {r.trigger.type !== "schedule" && activity && (
          <PeekSection title="Last 24 hours">
            <MiniStrip cells={cells} label={`Fired ${activity.fired} time${activity.fired === 1 ? "" : "s"} in 24 h`} />
            <p className="text-[12.5px] text-ink-muted">{activity.fired ? `Fired ${activity.fired}× in 24 h.` : "Quiet in 24 h."}</p>
          </PeekSection>
        )}
      </PeekFrame>
      {dialog}
    </>
  );
}
