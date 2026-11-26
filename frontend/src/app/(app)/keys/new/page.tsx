"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { Dialog } from "@/components/ui/Dialog";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { KeyEditor } from "@/components/keys/KeyEditor";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];

/** New API key (DESIGN.md §7: every create is a full page). The secret is
 * shown once, here; acknowledging it opens the key's page. */
export default function NewKeyPage() {
  const router = useRouter();
  const [secret, setSecret] = useState<ApiKeyCreateResponse | null>(null);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("apik.crumb"), href: "/keys" }]} />
      <KeyEditor keyId={null} onCreated={setSecret} />
      <Dialog open={secret != null} onClose={() => undefined} title={tr("apik.copyYourKey")}>
        {secret && (
          <SecretReveal
            fields={[{ label: tr("apik.apiKey"), value: secret.key, secret: true }]}
            title={
              <>
                {richT(tr, "apik.notAgain", { name: <strong>{secret.api_key.name}</strong> })}
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
