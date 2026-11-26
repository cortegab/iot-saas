"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { ApiRequestError, apiClient } from "@/lib/api-client";
import { useT } from "@/lib/i18n";

/** Choose a new password from an emailed link (`?token=`). Every other
 * session of the account is signed out. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useT();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8 ? t("auth.use8") : null;
  const mismatch = touched && confirm !== password ? t("auth.reset.mismatch") : null;

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
      setError(err instanceof ApiRequestError ? err.message : t("auth.reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <Link href="/forgot-password" className="font-medium text-accent hover:underline">
      {t("auth.reset.newLink")}
    </Link>
  );

  if (!token) {
    return (
      <AuthCard title={t("auth.reset.incompleteTitle")} description={t("auth.reset.incompleteDescription")} footer={footer}>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.reset.title")} description={t("auth.reset.description")} footer={footer}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        <Field label={t("auth.reset.newPassword")} error={tooShort} hint={t("auth.atLeast8")}>
          <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t("auth.reset.repeat")} error={mismatch}>
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
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("auth.reset.saving") : t("auth.reset.change")}
        </Button>
      </form>
    </AuthCard>
  );
}
