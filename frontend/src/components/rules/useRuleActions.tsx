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
import { RULE_SAFETY, guardsHardware, resetLatchVerdict } from "@iodriven/shared/rule-safety";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

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
    // Turning off a rule that switches hardware, or that latches, removes a
    // protection: say so before it happens, not only with an Undo after.
    if (!enabled && undoable && guardsHardware(rule)) {
      const ok = await confirm(RULE_SAFETY.disableGuarded, { title: t("rules.actions.disableTitle", { name: rule.name }), confirmLabel: t("rules.actions.disableConfirm") });
      if (!ok) return;
    }
    try {
      await api.patch(`/rules/${rule.id}`, { enabled });
      changed(rule);
      toast({
        title: t(enabled ? "rules.actions.enabledOne" : "rules.actions.disabledOne", { name: rule.name }),
        detail: enabled ? t("rules.actions.enabledDetail") : t("rules.actions.disabledDetail"),
        action: undoable ? { label: t("devices.toast.undo"), onClick: () => void setEnabled(rule, !enabled, false) } : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: t("rules.actions.updateFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Resolves true once the rule is deleted. `gone` runs before the re-fetch. */
  async function remove(rule: RuleResponse, gone?: () => void): Promise<boolean> {
    const ok = await confirm(
      t("rules.actions.deleteBody"),
      { title: t("rules.actions.deleteTitle", { name: rule.name }), confirmLabel: t("rules.actions.deleteConfirm") },
    );
    if (!ok) return false;
    try {
      await api.delete(`/rules/${rule.id}`);
      toast({ title: t("rules.actions.deleted", { name: rule.name }) });
      gone?.();
      changed(rule);
      return true;
    } catch (err) {
      toast({ tone: "error", title: t("rules.actions.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
      return false;
    }
  }

  // Run now bypasses the hold time and can drive an actuator at once.
  async function runNow(rule: RuleResponse) {
    const ok = await confirm(
      t("rules.actions.runBody"),
      { title: t("rules.actions.runTitle", { name: rule.name }), confirmLabel: t("rules.actions.runConfirm"), danger: false },
    );
    if (!ok) return;
    try {
      await api.post(`/rules/${rule.id}/run`, {});
      toast({ title: t("rules.actions.ran"), detail: t("rules.actions.ranDetail", { name: rule.name }) });
      setTimeout(() => void revalidate(`/rules/${rule.id}/executions`), 1500);
    } catch (err) {
      toast({ tone: "error", title: t("rules.actions.runFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // A copy starts disabled: two live rules on the same actuator fight.
  async function duplicate(rule: RuleResponse) {
    try {
      const copy = await api.post<RuleResponse>("/rules", { ...draftToRequest(draftFromRule(rule)), name: `${rule.name} (copy)`, enabled: false });
      upsertRuleInCache(copy);
      void revalidate("/rules");
      toast({ title: t("rules.actions.duplicated"), detail: t("rules.actions.duplicatedDetail") });
      router.push(`/rules/${copy.id}`);
    } catch (err) {
      toast({ tone: "error", title: t("rules.actions.duplicateFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Re-arms a latched rule (DESIGN.md §9.8). The confirmation lists the
   * current readings and says, from a dry run, whether it would fire again
   * right away: a reset can switch hardware again. */
  async function resetLatch(rule: RuleResponse) {
    let sim: SimulateResponse | null = null;
    try {
      sim = await api.query<SimulateResponse>(`/rules/${rule.id}/simulate`, {});
    } catch {
      // resetLatchVerdict(null) keeps the cautious wording.
    }
    const verdict = resetLatchVerdict(sim);
    const readings = rule.health.signals;
    const ok = await confirm(verdict, {
      title: t("rules.actions.resetTitle", { name: rule.name }),
      confirmLabel: t("rules.actions.resetConfirm"),
      danger: false,
      details:
        readings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-meta">
            {readings.map((s) => (
              <li key={`${s.device_id}/${s.metric}`} className="flex justify-between gap-3">
                <span className="text-ink-muted">
                  {t("rules.actions.reading", { metric: s.metric, device: s.device_name ?? t("rules.page.aDevice") })}
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
      toast({ title: t("rules.actions.reset"), detail: t("rules.actions.resetDetail", { name: rule.name }) });
      // The worker clears the flag asynchronously.
      setTimeout(() => changed(rule), 1000);
    } catch (err) {
      toast({ tone: "error", title: t("rules.actions.resetFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The ⋯ menu. `where` drops what that place already shows: the list has
   * Open, a peek has its own button and Copy link, the rule's page has Run
   * now as a button. `onDeleted` runs after a delete. */
  function menu(rule: RuleResponse, opts: { where?: "list" | "peek" | "page"; onDeleted?: () => void } = {}): DropdownMenuItem[][] {
    const where = opts.where ?? "list";
    const first: DropdownMenuItem[] = [];
    if (where === "list") first.push({ label: t("rules.actions.open"), icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/rules/${rule.id}`) });
    if (where === "peek") {
      first.push({
        label: t("rules.actions.copyLink"),
        icon: <Link2 size={15} />,
        onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/rules/${rule.id}`).then(() => toast({ tone: "info", title: t("rules.actions.linkCopied") })),
      });
    }
    if (!canWrite) return first.length ? [first] : [];
    return [
      [
        ...first,
        ...(where === "page" ? [] : [{ label: t("rules.actions.runNow"), icon: <Play size={15} />, onClick: () => void runNow(rule) }]),
        ...(rule.latched ? [{ label: t("rules.page.resetLatch"), icon: <Lock size={15} />, onClick: () => void resetLatch(rule) }] : []),
        { label: t("rules.actions.duplicate"), icon: <Copy size={15} />, onClick: () => void duplicate(rule) },
        { label: rule.enabled ? t("devices.disable") : t("devices.enable"), icon: <Power size={15} />, onClick: () => void setEnabled(rule, !rule.enabled) },
      ],
      [{ label: t("rules.actions.deleteDots"), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(rule, opts.onDeleted) }],
    ];
  }

  return { setEnabled, remove, runNow, duplicate, resetLatch, menu, dialog, canWrite };
}
