"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ApiRequestError } from "@/lib/api-client";

/** Re-arms a latched rule (strategy "latch"). If its condition is still
 * true, it latches again after its hold time — so this can fire the rule's
 * actions again; hence the confirm dialog. */
export function ResetLatchButton({ ruleId }: { ruleId: string }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function reset() {
    const ok = await confirm(
      "Reset this latched rule? If its condition is still true, it fires again after its hold time.",
      { confirmLabel: "Reset" },
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      await api.post(`/rules/${ruleId}/reset`, {});
      setNote("Reset sent.");
      // The worker clears the flag asynchronously.
      setTimeout(() => {
        void mutate(`/rules/${ruleId}`);
        void mutate("/rules");
      }, 1000);
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : "Couldn't reset this rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-xs text-ink-muted">{note}</span>}
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void reset()}>
        {busy ? "Resetting…" : "Reset"}
      </Button>
      {dialog}
    </div>
  );
}
