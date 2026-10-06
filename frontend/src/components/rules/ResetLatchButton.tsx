"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type SimulateResponse = components["schemas"]["SimulateResponse"];

/** Re-arms a latched rule (DESIGN.md §9.8). The confirmation lists the
 * current readings and says, from a dry run, whether the rule would fire
 * again right away — a reset can switch hardware again. */
export function ResetLatchButton({ rule }: { rule: RuleResponse }) {
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    let verdict = "We couldn't check the current readings. If the condition still holds, it fires again after its hold time.";
    try {
      const sim = await api.query<SimulateResponse>(`/rules/${rule.id}/simulate`, {});
      verdict =
        sim.unavailable_signals.length > 0
          ? "Some readings are missing or stale, so it won't fire until they report again."
          : sim.would_fire
            ? "The condition holds right now: it fires again after its hold time."
            : "The condition doesn't hold right now: it waits for the next crossing.";
    } catch {
      // Keep the cautious wording above.
    }
    setBusy(false);
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
                <span className="font-medium text-ink tabular-nums">
                  {s.last_value ?? "—"}
                  <span className="ml-1.5 font-normal text-ink-muted">{s.state === "fresh" ? timeAgo(s.last_seen_at) : s.state}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : undefined,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/rules/${rule.id}/reset`, {});
      toast({ title: "Latch reset", detail: rule.name });
      // The worker clears the flag asynchronously.
      setTimeout(() => {
        void mutate(`/rules/${rule.id}`);
        void mutate("/rules");
      }, 1000);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't reset the rule", detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void reset()}>
        {busy ? "Checking…" : "Reset"}
      </Button>
      {dialog}
    </>
  );
}
