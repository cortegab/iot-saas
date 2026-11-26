"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { HOME } from "@/lib/landing";
import { useApi } from "@/hooks/useApi";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type TenantResponse = components["schemas"]["TenantResponse"];

/** "Create workspace" from the workspace switcher: POST /tenants (the caller
 * becomes its owner), refresh the session so the new membership is known,
 * then switch to it. */
export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { refresh, setCurrentTenantId } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  function close() {
    setName("");
    setError(null);
    onClose();
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("workspaceDialog.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tenant = await api.post<TenantResponse>("/tenants", { name: trimmed });
      await refresh();
      setCurrentTenantId(tenant.id);
      close();
      // A new workspace lands like a sign-in: on Get started.
      router.push(HOME);
      toast({ title: t("workspaceDialog.created"), detail: t("workspaceDialog.createdDetail", { name: tenant.name }) });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("workspaceDialog.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("workspaceDialog.title")}
      description={t("workspaceDialog.description")}
      onSubmit={() => void create()}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("workspaceDialog.creating") : t("workspaceDialog.title")}
          </Button>
        </>
      }
    >
      <Field label={t("workspaceDialog.name")} error={error}>
        <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workspaceDialog.placeholder")} />
      </Field>
    </Dialog>
  );
}
