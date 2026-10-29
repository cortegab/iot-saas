"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { KeyEditor } from "@/components/keys/KeyEditor";

/** An API key's page: read-only details and Revoke (DESIGN.md §8). The crumb
 * goes back to the list with this key peeked. */
export default function KeyPage() {
  const { keyId } = useParams<{ keyId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "API keys", href: `/keys?peek=${keyId}&show=all` }]} />
      <KeyEditor key={keyId} keyId={keyId} />
    </>
  );
}
