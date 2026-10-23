"use client";

import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Copy, Link2, Lock, Play, Power, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { draftFromRule, draftToRequest } from "@/lib/rule-draft";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type SimulateResponse = components["schemas"]["SimulateResponse"];

/** A rule's record actions (Run now, Reset latch, Duplicate, Enable/Disable,
 * Delete) and its ⋯ menu, shared by the rules list, its peek and the rule
 * page so each offers the same items with the same confirmations (demo H). */
export function useRuleActions({ onChanged }: { onChanged?: (rule: RuleResponse) => void } = {}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("rules.write");
  const { confirm, dialog } = useConfirm();

  // A rule's device pages cache their rules under `/devices/{id}/rules`.
  function changed(rule: RuleResponse) {
    void revalidate("/rules");
    void revalidate(`/rules/${rule.id}`);
    for (const d of rule.devices) void revalidate(`/devices/${d.device_id}/rules`);
    onChanged?.(rule);
  }

  async function setEnabled(rule: RuleResponse, enabled: boolean, undoable = true) {
    try {
      await api.patch(`/rules/${rule.id}`, { enabled });
      changed(rule);
      toast({
        title: `${rule.name} ${enabled ? "enabled" : "disabled"}`,
        detail: enabled ? "Fires when its trigger and conditions are met." : "Keeps its settings and history, but won't fire.",
        action: undoable ? { label: "Undo", onClick: () => void setEnabled(rule, !enabled, false) } : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Resolves true once the rule is deleted. `gone` runs before the re-fetch. */
  async function remove(rule: RuleResponse, gone?: () => void): Promise<boolean> {
    const ok = await confirm(
      "It stops evaluating immediately. Actuators keep their current state. This can't be undone; to pause it instead, disable it.",
      { title: `Delete ${rule.name}?`, confirmLabel: "Delete rule" },
    );
    if (!ok) return false;
    try {
      await api.delete(`/rules/${rule.id}`);
      toast({ title: `${rule.name} deleted` });
      gone?.();
      changed(rule);
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
      return false;
    }
  }

  // Run now bypasses the hold time and can drive an actuator at once.
  async function runNow(rule: RuleResponse) {
    const ok = await confirm(
      "It's evaluated right now, and its actions run if the condition holds. This can command a device immediately.",
      { title: `Run ${rule.name} now?`, confirmLabel: "Run now", danger: false },
    );
    if (!ok) return;
    try {
      await api.post(`/rules/${rule.id}/run`, {});
      toast({ title: "Ran once", detail: `${rule.name}: see Activity for what it did.` });
      setTimeout(() => void revalidate(`/rules/${rule.id}/executions`), 1500);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't run this rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // A copy starts disabled: two live rules on the same actuator fight.
  async function duplicate(rule: RuleResponse) {
    try {
      const copy = await api.post<RuleResponse>("/rules", { ...draftToRequest(draftFromRule(rule)), name: `${rule.name} (copy)`, enabled: false });
      upsertRuleInCache(copy);
      void revalidate("/rules");
      toast({ title: "Rule duplicated", detail: "The copy starts disabled." });
      router.push(`/rules/${copy.id}`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't duplicate the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Re-arms a latched rule (DESIGN.md §9.8). The confirmation lists the
   * current readings and says, from a dry run, whether it would fire again
   * right away: a reset can switch hardware again. */
  async function resetLatch(rule: RuleResponse) {
    let verdict = "We couldn't check the current readings. If the condition still holds, it fires again after its hold time.";
    try {
      const sim = await api.query<SimulateResponse>(`/rules/${rule.id}/simulate`, {});
      verdict =
        sim.unavailable_signals.length > 0
          ? "It re-arms now. Some readings are missing or stale, so it can't fire until they report."
          : sim.would_fire
            ? "It re-arms now. Its condition is still true, so it fires again after its hold time."
            : "It re-arms now. Its condition is false now, so it won't fire straight away.";
    } catch {
      // Keep the cautious wording above.
    }
    const readings = rule.health.signals;
    const ok = await confirm(verdict, {
      title: `Reset ${rule.name}?`,
      confirmLabel: "Reset latch",
      danger: false,
      details:
        readings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-[13px]">
            {readings.map((s) => (
              <li key={`${s.device_id}/${s.metric}`} className="flex justify-between gap-3">
                <span className="text-ink-muted">
                  {s.metric} on {s.device_name ?? "a device"}
                </span>
                <span className="font-medium tabular-nums text-ink">
                  {s.last_value ?? "—"}
                  <span className="ml-1.5 font-normal text-ink-muted">{s.state === "fresh" ? timeAgo(s.last_seen_at) : s.state}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : undefined,
    });
    if (!ok) return;
    try {
      await api.post(`/rules/${rule.id}/reset`, {});
      toast({ title: "Latch reset", detail: `${rule.name} is armed again.` });
      // The worker clears the flag asynchronously.
      setTimeout(() => changed(rule), 1000);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't reset the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The ⋯ menu. `where` drops what that place already shows: the list has
   * Open, a peek has its own button and Copy link, the rule's page has Run
   * now as a button. `onDeleted` runs after a delete. */
  function menu(rule: RuleResponse, opts: { where?: "list" | "peek" | "page"; onDeleted?: () => void } = {}): DropdownMenuItem[][] {
    const where = opts.where ?? "list";
    const first: DropdownMenuItem[] = [];
    if (where === "list") first.push({ label: "Open", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/rules/${rule.id}`) });
    if (where === "peek") {
      first.push({
        label: "Copy link",
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/rules/${rule.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
      });
    }
    if (!canWrite) return first.length ? [first] : [];
    return [
      [
        ...first,
        ...(where === "page" ? [] : [{ label: "Run now…", icon: <Play size={15} />, onClick: () => void runNow(rule) }]),
        ...(rule.latched ? [{ label: "Reset latch…", icon: <Lock size={15} />, onClick: () => void resetLatch(rule) }] : []),
        { label: "Duplicate", icon: <Copy size={15} />, onClick: () => void duplicate(rule) },
        { label: rule.enabled ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => void setEnabled(rule, !rule.enabled) },
      ],
      [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(rule, opts.onDeleted) }],
    ];
  }

  return { setEnabled, remove, runNow, duplicate, resetLatch, menu, dialog, canWrite };
}
