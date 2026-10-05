"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Callout } from "@/components/ui/Callout";
import { AuthCard } from "@/components/auth/AuthCard";
import { ApiRequestError } from "@/lib/api-client";
import { safeNext } from "@/lib/safe-next";

/** Sign in. The full demo G sign-in (network canvas, stats) lands with the
 * public pages; this keeps the same card, fields and states. */
export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? "That email and password don't match. Check both and try again."
          : "Couldn't sign in right now. Try again in a moment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back."
      footer={
        <>
          No account?{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5">
        {params.get("reset") === "1" && <Callout>Password changed. Sign in with the new one.</Callout>}
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-[5px]">
          <Field label="Password">
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Link href="/forgot-password" className="self-end text-[12.5px] font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="h-11 w-full text-[15px]">
          {submitting ? "Signing in…" : "Log in"}
        </Button>
      </form>
    </AuthCard>
  );
}
