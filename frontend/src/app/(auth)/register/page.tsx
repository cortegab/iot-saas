"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiRequestError } from "@/lib/api-client";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Registration also creates the workspace (tenant) in the same call — no
      // separate "create a workspace" step, part of keeping onboarding fast.
      await register(email, password, tenantName, name);
      router.replace("/devices");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <div>
        <h1 className="text-xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-ink-muted">Takes under a minute — no credit card.</p>
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Workspace name
        <Input
          type="text"
          required
          autoComplete="organization"
          value={tenantName}
          onChange={(e) => setTenantName(e.target.value)}
          placeholder="e.g. My Workshop"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Name <span className="text-ink-muted/70">(optional)</span>
        <Input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jamie Rivera"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Email
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Password
        <Input
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <Button type="submit" size="md" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent">
          Log in
        </Link>
      </p>
    </form>
  );
}
