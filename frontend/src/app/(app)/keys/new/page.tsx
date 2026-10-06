"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { Dialog } from "@/components/ui/Dialog";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { KeyEditor } from "@/components/keys/KeyEditor";
import type { components } from "@/types/api";

type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];

/** New API key (DESIGN.md §7: every create is a full page). The secret is
 * shown once, here; acknowledging it opens the key's page. */
export default function NewKeyPage() {
  const router = useRouter();
  const [secret, setSecret] = useState<ApiKeyCreateResponse | null>(null);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "API keys", href: "/keys" }, { label: "New" }]} />
      <KeyEditor keyId={null} onCreated={setSecret} />
      <Dialog open={secret != null} onClose={() => undefined} title="Your new API key">
        {secret && (
          <SecretReveal
            fields={[{ label: "API key", value: secret.key, secret: true }]}
            title={
              <>
                Copy it now. We store only a hash, so <strong>{secret.api_key.name}</strong> can&apos;t be shown again.
              </>
            }
            requireAcknowledge
            onDismiss={() => router.replace(`/keys/${secret.api_key.id}`)}
          />
        )}
      </Dialog>
    </>
  );
}
