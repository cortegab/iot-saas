"use client";

import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

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
      toast({ tone: "error", title: "Only an owner can remove an owner" });
      return;
    }
    const ok = await confirm("They lose access immediately. Their dashboards are deleted; rules they created keep running.", {
      title: `Remove ${m.name || m.email}?`,
      confirmLabel: "Remove member",
    });
    if (!ok) return;
    try {
      await api.delete(`/tenants/members/${m.user_id}`);
      await revalidate("/tenants/members");
      toast({ title: "Member removed", detail: m.email });
      onRemoved?.(m.user_id);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't remove the member", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function resend(i: InvitationResponse) {
    try {
      await api.post(`/tenants/invitations/${i.id}/resend`);
      await revalidate("/tenants/invitations");
      toast({ title: "Invite resent", detail: `${i.email} · the new link expires in 7 days.` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't resend the invite", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  async function cancelInvite(i: InvitationResponse) {
    const ok = await confirm("The link in their email stops working.", { title: `Cancel the invite for ${i.email}?`, confirmLabel: "Cancel invite", cancelLabel: "Keep it" });
    if (!ok) return;
    try {
      await api.delete(`/tenants/invitations/${i.id}`);
      await revalidate("/tenants/invitations");
      toast({ title: "Invite cancelled", detail: i.email });
      onRemoved?.(`invite.${i.id}`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't cancel the invite", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  return { removeMember, resend, cancelInvite, dialog };
}
