"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ApiRequestError } from "@/lib/api-client";

/** Create an account (DESIGN.md §10): the workspace is created in the same
 * step, so onboarding goes straight to adding a device. */
export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const shortPassword = touched && password.length > 0 && password.length < 8 ? "Use at least 8 characters." : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (password.length < 8) return;
    setError(null);
    setSubmitting(true);
    try {
      await register(email.trim(), password, tenantName.trim(), name);
      router.replace("/devices");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create the account. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Your workspace is created in the same step."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5">
        <Field label="Workspace name" hint="Your company or site. You can rename it later.">
          <Input required autoComplete="organization" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="e.g. Northfield Greenhouses" />
        </Field>
        <Field label="Your name" optional>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={shortPassword}>
          <PasswordInput required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="h-11 w-full text-[15px]">
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
