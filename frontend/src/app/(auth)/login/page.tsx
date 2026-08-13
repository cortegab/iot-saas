"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiRequestError } from "@/lib/api-client";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
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
        <h1 className="text-xl font-semibold text-ink">Log in</h1>
        <p className="mt-1 text-sm text-ink-muted">Welcome back.</p>
      </div>

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
          autoComplete="current-password"
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
        {submitting ? "Logging in…" : "Log in"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        No account?{" "}
        <Link href="/register" className="text-accent">
          Register
        </Link>
      </p>
    </form>
  );
}
