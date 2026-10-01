"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { ApiRequestError, apiClient } from "@/lib/api-client";

/** Choose a new password from an emailed link (`?token=`). Every other
 * session of the account is signed out. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8 ? "Use at least 8 characters." : null;
  const mismatch = touched && confirm !== password ? "The two passwords don't match." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (password.length < 8 || confirm !== password) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/auth/reset-password", {}, { token, password });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change the password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <Link href="/forgot-password" className="font-medium text-accent hover:underline">
      Ask for a new link
    </Link>
  );

  if (!token) {
    return (
      <AuthCard title="This link is incomplete" description="Open the link from the email again, or ask for a new one." footer={footer}>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="Other sessions of this account will be signed out." footer={footer}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        <Field label="New password" error={tooShort} hint="At least 8 characters.">
          <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repeat it" error={mismatch}>
          <Input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-11 w-full text-[15px]">
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </AuthCard>
  );
}
