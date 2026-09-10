"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ApiRequestError } from "@/lib/api-client";

/** "Run now" — asks the worker to evaluate this rule against the live signal
 * cache and fire its actions if the condition is currently met. It bypasses
 * the for_duration hold, so it can drive a real actuator immediately — hence
 * the confirm dialog. */
export function RunNowButton({ ruleId }: { ruleId: string }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    const ok = await confirm(
      "Evaluate this rule right now and run its actions if the condition is met? This can command a device immediately.",
      { confirmLabel: "Run now" },
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      await api.post(`/rules/${ruleId}/run`, {});
      setNote("Queued — check Activity in a moment.");
      setTimeout(() => void mutate(`/rules/${ruleId}/executions`), 1500);
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : "Couldn't run this rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-xs text-ink-muted">{note}</span>}
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run()}>
        {busy ? "Running…" : "Run now"}
      </Button>
      {dialog}
    </div>
  );
}
