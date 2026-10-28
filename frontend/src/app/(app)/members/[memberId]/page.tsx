"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { MemberEditor } from "@/components/members/MemberEditor";

/** A member's page: their role (DESIGN.md §7). The crumb goes back to the
 * list with this member peeked. */
export default function MemberPage() {
  const { memberId } = useParams<{ memberId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Members", href: `/members?peek=${memberId}` }]} />
      <MemberEditor key={memberId} memberId={memberId} />
    </>
  );
}
