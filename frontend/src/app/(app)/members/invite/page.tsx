"use client";

import { Breadcrumbs } from "@/components/ui/PageHeader";
import { MemberEditor } from "@/components/members/MemberEditor";

/** Invite a member (DESIGN.md §7: every create and edit is a full page). */
export default function InviteMemberPage() {
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Members", href: "/members" }, { label: "Invite" }]} />
      <MemberEditor memberId={null} />
    </>
  );
}
