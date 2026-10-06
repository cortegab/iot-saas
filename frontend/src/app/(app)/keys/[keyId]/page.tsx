"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { KeyEditor } from "@/components/keys/KeyEditor";
import type { ApiKey } from "@/lib/api-key-status";

/** An API key's page: read-only details and Revoke (DESIGN.md §8). The crumb
 * goes back to the list with this key peeked. */
export default function KeyPage() {
  const { keyId } = useParams<{ keyId: string }>();
  const { data: keys } = useApiSWR<ApiKey[]>("/api-keys");
  const key = keys?.find((k) => k.id === keyId);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "API keys", href: `/keys?peek=${keyId}&show=all` }, { label: key?.name ?? "API key" }]} />
      <KeyEditor key={keyId} keyId={keyId} />
    </>
  );
}
