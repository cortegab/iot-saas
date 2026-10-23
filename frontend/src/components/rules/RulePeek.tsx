"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { PeekFrame, PeekPlaceholder, PeekSection } from "@/components/editor/PeekFrame";
import { RULE_STATE, actionsText, ruleStateKey, triggerText } from "@/lib/rule-text";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleActivityResponse = components["schemas"]["RuleActivityResponse"];

const STATE = RULE_STATE;

/** A rule at a glance: what it watches and does, its last day, and whether it
 * shares an actuator. It's edited on /rules/{id}. */
export function RulePeek({
  rule,
  activity,
  shares,
  onClose,
  menu,
}: {
  rule: RuleResponse | undefined;
  activity: RuleActivityResponse | undefined;
  /** Actuators another enabled rule also drives. */
  shares: string[] | undefined;
  onClose: () => void;
  /** The record's ⋯ menu (useRuleActions, `where: "peek"`). */
  menu: (r: RuleResponse) => DropdownMenuItem[][];
}) {
  const { can } = usePermissions();
  const canWrite = can("rules.write");
  if (!rule) return <PeekPlaceholder noun="rule" missing onClose={onClose} />;
  const r = rule;

  const state = STATE[ruleStateKey(r)];
  const devices = Array.from(new Map(r.devices.map((d) => [d.device_id, d.device_name ?? "Unnamed device"])));
  const cells: StripCell[] = activity ? [...activity.cells] : [];
  if (r.enabled && !r.health.evaluatable && cells.length > 0 && cells[cells.length - 1] === "idle") cells[cells.length - 1] = "unknown";


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
        menu={menu(r)}
        onClose={onClose}
      >
        {r.trigger.type !== "schedule" && activity && (
          <PeekSection title="Last 24 hours">
            <MiniStrip cells={cells} label={`Fired ${activity.fired} time${activity.fired === 1 ? "" : "s"} in 24 h`} />
            <p className="text-[12.5px] text-ink-muted">{activity.fired ? `Fired ${activity.fired}× in 24 h.` : "Quiet in 24 h."}</p>
          </PeekSection>
        )}
      </PeekFrame>
    </>
  );
}
