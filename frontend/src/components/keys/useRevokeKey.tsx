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
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

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
        {richT(tr, "apik.revokeBody", { prefix: <code className="font-mono">{k.key_prefix}…</code> }, { when: k.last_used_at ? timeAgo(k.last_used_at) : tr("apik.neverLower") })}
      </>,
      { title: tr("apik.revokeTitle", { name: k.name }), confirmLabel: tr("apik.revokeConfirm") },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${k.id}`);
      await revalidate("/api-keys");
      toast({ title: tr("apik.revokedToast"), detail: k.name });
    } catch (err) {
      toast({ tone: "error", title: tr("apik.revokeFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function remove(k: ApiKey, onDeleted?: () => void) {
    const ok = await confirm(
      <>
        {richT(tr, "apik.deleteBody", { prefix: <code className="font-mono">{k.key_prefix}…</code> })}
      </>,
      { title: tr("apik.deleteTitle", { name: k.name }), confirmLabel: tr("apik.deleteConfirm") },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${k.id}/permanent`);
      onDeleted?.();
      await revalidate("/api-keys");
      toast({ title: tr("apik.deleted"), detail: k.name });
    } catch (err) {
      toast({ tone: "error", title: tr("apik.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The menu's last group: Revoke… while the key works, Delete… after. */
  function endItems(k: ApiKey, onDeleted?: () => void): DropdownMenuItem[][] {
    return keyStatus(k) === "active"
      ? [[{ label: tr("apik.revokeMenu"), icon: <Ban size={15} />, danger: true, onClick: () => void revoke(k) }]]
      : [[{ label: tr("apik.deleteMenu"), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(k, onDeleted) }]];
  }

  return { revoke, remove, endItems, dialog };
}
