"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { AuthCard } from "@/components/auth/AuthCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ApiRequestError, apiClient } from "@/lib/api-client";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { safeNext } from "@/lib/safe-next";
import type { components } from "@/types/api";

type TokenPairResponse = components["schemas"]["TokenPairResponse"];

/** Sign in (DESIGN.md §10). One generic error (never "no such email"),
 * show/hide password, a Caps Lock hint once two attempts have failed, and a
 * workspace choice when the account belongs to more than one. */
export default function LoginPage() {
  const { adoptSession } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState(0);
  const [capsOn, setCapsOn] = useState(false);
  const [choosing, setChoosing] = useState<TokenPairResponse | null>(null);

  function enter(data: TokenPairResponse, tenantId?: string) {
    adoptSession(data, tenantId);
    router.replace(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiClient.post<TokenPairResponse>("/auth/login", {}, { email, password });
      // An explicit destination (an invite link, a deep link) wins; otherwise
      // more than one workspace means asking which one.
      if (data.memberships.length > 1 && !params.get("next")) setChoosing(data);
      else enter(data);
    } catch (err) {
      setFailures((n) => n + 1);
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? "That email and password don't match. Check both and try again."
          : "Couldn't sign in right now. Try again in a moment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (choosing) {
    return (
      <AuthCard title="Choose a workspace" description={`${email} belongs to ${choosing.memberships.length} workspaces.`}>
        <ul aria-label="Workspaces" className="flex flex-col gap-2">
          {choosing.memberships.map((m) => {
            const role = toRole(m.role);
            return (
              <li key={m.tenant_id}>
                <button
                  type="button"
                  onClick={() => enter(choosing, m.tenant_id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-canvas px-3.5 py-3 text-left hover:border-accent"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
                    <Building2 aria-hidden size={17} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="truncate text-sm font-semibold text-ink">{m.tenant_name}</strong>
                    <span className="text-[12.5px] text-ink-muted">{role ? ROLE_LABEL[role] : m.role}</span>
                  </span>
                  <ChevronRight aria-hidden size={16} className="text-ink-muted" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-[12.5px] text-ink-muted">Switch any time from the workspace menu at the top of the sidebar.</p>
      </AuthCard>
    );
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
          <Field label="Password" warning={failures >= 2 && capsOn ? "Caps Lock is on." : undefined}>
            <PasswordInput required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onCapsLock={setCapsOn} />
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
