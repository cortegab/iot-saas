"use client";

import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type MemberResponse = components["schemas"]["MemberResponse"];
type InvitationResponse = components["schemas"]["InvitationResponse"];

/** Remove a member, resend or cancel an invite — shared by the members list,
 * the peek and the member page. `onRemoved` runs after a member or an invite
 * is gone (e.g. close the peek, leave the page). */
export function useMemberActions(onRemoved?: (id: string) => void) {
  const api = useApi();
  const toast = useToast();
  const { role: myRole } = usePermissions();
  const { confirm, dialog } = useConfirm();

  async function removeMember(m: MemberResponse) {
    if (m.role === "owner" && myRole !== "owner") {
      toast({ tone: "error", title: tr("mem.ownerRemove") });
      return;
    }
    const ok = await confirm(tr("mem.removeBody"), {
      title: tr("mem.removeTitle", { name: m.name || m.email }),
      confirmLabel: tr("mem.removeConfirm"),
    });
    if (!ok) return;
    try {
      await api.delete(`/tenants/members/${m.user_id}`);
      await revalidate("/tenants/members");
      toast({ title: tr("mem.removed"), detail: m.email });
      onRemoved?.(m.user_id);
    } catch (err) {
      toast({ tone: "error", title: tr("mem.removeFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function resend(i: InvitationResponse) {
    try {
      await api.post(`/tenants/invitations/${i.id}/resend`);
      await revalidate("/tenants/invitations");
      toast({ title: tr("mem.resent"), detail: tr("mem.resentDetail", { email: i.email }) });
    } catch (err) {
      toast({ tone: "error", title: tr("mem.resendFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function cancelInvite(i: InvitationResponse) {
    const ok = await confirm(tr("mem.cancelBody"), { title: tr("mem.cancelTitle", { email: i.email }), confirmLabel: tr("mem.cancelConfirm"), cancelLabel: tr("mem.keep") });
    if (!ok) return;
    try {
      await api.delete(`/tenants/invitations/${i.id}`);
      await revalidate("/tenants/invitations");
      toast({ title: tr("mem.cancelled"), detail: i.email });
      onRemoved?.(`invite.${i.id}`);
    } catch (err) {
      toast({ tone: "error", title: tr("mem.cancelFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  return { removeMember, resend, cancelInvite, dialog };
}
