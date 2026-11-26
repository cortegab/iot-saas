"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { apiClient } from "@/lib/api-client";
import { richT, useT } from "@/lib/i18n";

/** Ask for a reset link. The answer is the same whether or not the email has
 * an account, so the page never reveals who is registered. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const t = useT();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/auth/forgot-password", {}, { email: email.trim() });
      setSent(true);
    } catch {
      setError(t("auth.forgot.failed"));
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link href="/login" className="font-medium text-accent hover:underline">
      {t("auth.forgot.back")}
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title={t("auth.forgot.sentTitle")} footer={back}>
        <p className="flex gap-2.5 text-sm text-ink">
          <MailCheck aria-hidden size={18} className="mt-0.5 shrink-0 text-status-online" />
          <span>{richT(t, "auth.forgot.sentBody", { email: <strong>{email.trim()}</strong> })}</span>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.forgot.title")} description={t("auth.forgot.description")} footer={back}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        <Field label={t("auth.email")} error={error}>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t("auth.forgot.sending") : t("auth.forgot.send")}
        </Button>
      </form>
    </AuthCard>
  );
}
