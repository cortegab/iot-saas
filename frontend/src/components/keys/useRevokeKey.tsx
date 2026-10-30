"use client";

import { mutate as revalidate } from "swr";
import { Ban, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { keyStatus, type ApiKey } from "@/lib/api-key-status";
import { timeAgo } from "@/lib/time-ago";

/** Revoke an active API key, or delete one that no longer works (revoked or
 * expired), each with its real consequence — shared by the keys list, the
 * peek and the key page. */
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

  async function remove(k: ApiKey, onDeleted?: () => void) {
    const ok = await confirm(
      <>
        It already can&apos;t authenticate. Deleting removes it from the list for good; its history in logs keeps the prefix{" "}
        <code className="font-mono">{k.key_prefix}…</code>.
      </>,
      { title: `Delete ${k.name}?`, confirmLabel: "Delete key" },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${k.id}/permanent`);
      onDeleted?.();
      await revalidate("/api-keys");
      toast({ title: "Key deleted", detail: k.name });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the key", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The menu's last group: Revoke… while the key works, Delete… after. */
  function endItems(k: ApiKey, onDeleted?: () => void): DropdownMenuItem[][] {
    return keyStatus(k) === "active"
      ? [[{ label: "Revoke…", icon: <Ban size={15} />, danger: true, onClick: () => void revoke(k) }]]
      : [[{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(k, onDeleted) }]];
  }

  return { revoke, remove, endItems, dialog };
}
