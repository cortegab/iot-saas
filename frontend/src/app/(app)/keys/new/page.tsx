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
      <Breadcrumbs crumbs={[{ label: "API keys", href: "/keys" }]} />
      <KeyEditor keyId={null} onCreated={setSecret} />
      <Dialog open={secret != null} onClose={() => undefined} title="Copy your key">
        {secret && (
          <SecretReveal
            fields={[{ label: "API key", value: secret.key, secret: true }]}
            title={
              <>
                It won&apos;t be shown again. Only a hash of <strong>{secret.api_key.name}</strong> is stored.
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
