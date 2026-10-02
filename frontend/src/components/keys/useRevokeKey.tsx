"use client";

import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { ApiKey } from "@/lib/api-key-status";
import { timeAgo } from "@/lib/time-ago";

/** Revoke an API key with the real consequence — shared by the keys list,
 * the peek and the key page. */
export function useRevokeKey() {
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  async function revoke(k: ApiKey) {
    const ok = await confirm(
      <>
        Requests using <code className="font-mono">{k.key_prefix}…</code> fail from now on. Last used {k.last_used_at ? timeAgo(k.last_used_at) : "never"}.
      </>,
      { title: `Revoke ${k.name}?`, confirmLabel: "Revoke key" },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${k.id}`);
      await revalidate("/api-keys");
      toast({ title: "Key revoked", detail: k.name });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't revoke the key", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  return { revoke, dialog };
}
