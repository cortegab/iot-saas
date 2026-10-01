"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { apiClient } from "@/lib/api-client";

/** Ask for a reset link. The answer is the same whether or not the email has
 * an account, so the page never reveals who is registered. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
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
      setError("Couldn't send the link right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link href="/login" className="font-medium text-accent hover:underline">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="Check your email" footer={back}>
        <p className="flex gap-2.5 text-sm text-ink">
          <MailCheck aria-hidden size={18} className="mt-0.5 shrink-0 text-status-online" />
          <span>
            If an account uses <strong>{email.trim()}</strong>, a reset link is on its way. It works once and expires in 30
            minutes.
          </span>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" description="We'll email you a link to choose a new one." footer={back}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
        <Field label="Email" error={error}>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy} className="h-11 w-full text-[15px]">
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
