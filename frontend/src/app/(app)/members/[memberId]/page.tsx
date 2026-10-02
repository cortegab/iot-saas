"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { MemberEditor } from "@/components/members/MemberEditor";
import type { components } from "@/types/api";

type MemberResponse = components["schemas"]["MemberResponse"];

/** A member's page: their role (DESIGN.md §7). The crumb goes back to the
 * list with this member peeked. */
export default function MemberPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { data: members } = useApiSWR<MemberResponse[]>("/tenants/members");
  const m = members?.find((x) => x.user_id === memberId);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Members", href: `/members?peek=${memberId}` }, { label: m ? m.name || m.email : "Member" }]} />
      <MemberEditor key={memberId} memberId={memberId} />
    </>
  );
}
