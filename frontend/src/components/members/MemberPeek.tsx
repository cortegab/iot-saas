"use client";

import { Send, Trash2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { PeekFrame, PeekOpen, PeekPlaceholder } from "@/components/editor/PeekFrame";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import { ROLE_HELP } from "./MemberEditor";
import { useMemberActions } from "./useMemberActions";
import type { components } from "@/types/api";

type MemberResponse = components["schemas"]["MemberResponse"];
type InvitationResponse = components["schemas"]["InvitationResponse"];

const roleLabel = (r: string) => {
  const role = toRole(r);
  return role ? ROLE_LABEL[role] : r;
};

/** A member or a pending invite at a glance; roles change on /members/{id}. */
export function MemberPeek({
  member,
  invite,
  isMe,
  onClose,
}: {
  member?: MemberResponse;
  invite?: InvitationResponse;
  isMe: boolean;
  onClose: () => void;
}) {
  const { role: myRole, can } = usePermissions();
  const canManage = can("members.manage");
  const { removeMember, resend, cancelInvite, dialog } = useMemberActions(onClose);

  if (invite) {
    return (
      <>
        <PeekFrame
          noun="invite"
          title={invite.email}
          eyebrow={
            <>
              <Badge tone="pending" shape="hollow" label="Invited" />
            </>
          }
          description="They join when they open the link in their email."
          facts={[
            ["Role", <Tag key="r">{roleLabel(invite.role)}</Tag>],
            ["Sent", timeAgo(invite.created_at)],
            ["Link expires", formatDate(invite.expires_at)],
          ]}
          primary={
            canManage ? (
              <Button size="sm" variant="secondary" onClick={() => void resend(invite)}>
                <Send aria-hidden size={14} /> Resend invite
              </Button>
            ) : undefined
          }
          menu={canManage ? [[{ label: "Cancel invite…", icon: <Trash2 size={15} />, danger: true, onClick: () => void cancelInvite(invite) }]] : undefined}
          onClose={onClose}
        />
        {dialog}
      </>
    );
  }
  if (!member) return <PeekPlaceholder noun="member" missing onClose={onClose} />;

  const role = toRole(member.role);
  const ownerLocked = member.role === "owner" && myRole !== "owner";
  const menu: DropdownMenuItem[][] =
    canManage && !isMe && !ownerLocked ? [[{ label: "Remove from workspace…", icon: <Trash2 size={15} />, danger: true, onClick: () => void removeMember(member) }]] : [];

  return (
    <>
      <PeekFrame
        noun="member"
        title={member.name || member.email}
        eyebrow={isMe ? "You" : undefined}
        description={role ? ROLE_HELP[role] : undefined}
        facts={[
          ["Email", <span key="e" className="font-mono text-[13px]">{member.email}</span>],
          ["Role", <Tag key="r">{roleLabel(member.role)}</Tag>],
          ["Joined", member.joined_at ? formatDate(member.joined_at) : null],
        ]}
        primary={<PeekOpen href={`/members/${member.user_id}`} noun="member" />}
        menu={menu}
        onClose={onClose}
      />
      {dialog}
    </>
  );
}
