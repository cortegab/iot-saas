"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ApiRequestError } from "@/lib/api-client";

/** A one-field dialog for naming a record — "New dashboard", "Rename",
 * "Duplicate". `onSubmit` may throw; its message shows under the field. */
export function NameDialog({
  open,
  onClose,
  title,
  description,
  label = "Name",
  initial = "",
  placeholder,
  confirmLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial);
      setError(null);
    }
  }, [open, initial]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} error={error}>
        <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
      </Field>
    </Dialog>
  );
}
