"use client";

import { Breadcrumbs } from "@/components/ui/PageHeader";
import { MemberEditor } from "@/components/members/MemberEditor";
import { tActive as tr } from "@iodriven/shared/i18n";

/** Invite a member (DESIGN.md §7: every create and edit is a full page). */
export default function InviteMemberPage() {
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("nav.members"), href: "/members" }]} />
      <MemberEditor memberId={null} />
    </>
  );
}
