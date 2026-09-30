"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useApi } from "@/hooks/useApi";
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

  function close() {
    setName("");
    setError(null);
    onClose();
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for the workspace.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tenant = await api.post<TenantResponse>("/tenants", { name: trimmed });
      await refresh();
      setCurrentTenantId(tenant.id);
      close();
      router.push("/dashboards");
      toast({ title: "Workspace created", detail: `You're the owner of ${tenant.name}.` });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create the workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create workspace"
      description="A separate set of devices, rules and members. You'll be its owner."
      onSubmit={() => void create()}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </>
      }
    >
      <Field label="Name" error={error}>
        <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Hillside Vineyard" />
      </Field>
    </Dialog>
  );
}
