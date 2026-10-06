"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { AuthCard, AuthScreen } from "@/components/auth/AuthCard";
import { ApiRequestError, apiClient } from "@/lib/api-client";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import type { components } from "@/types/api";

type Preview = components["schemas"]["InvitationPreviewResponse"];
type TokenPairResponse = components["schemas"]["TokenPairResponse"];

/** Accept a workspace invitation (DESIGN.md §8). Outside the (auth) group
 * because a signed-in person accepts here too. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status, accessToken, adoptSession, logout } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<Preview>(`/auth/invitations/${token}`)
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Couldn't open this invitation."));
  }, [token]);

  useEffect(() => {
    if (status !== "authenticated" || !accessToken) return;
    apiClient
      .get<{ email: string }>("/auth/me", { accessToken })
      .then((u) => setMe(u.email))
      .catch(() => setMe(null));
  }, [status, accessToken]);

  async function accept(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signedIn = status === "authenticated";
      const data = await apiClient.post<TokenPairResponse>(
        `/auth/invitations/${token}/accept`,
        signedIn ? { accessToken } : {},
        signedIn ? {} : { name: name.trim() || null, password },
      );
      const joined = data.memberships.find((m) => m.tenant_name === preview?.tenant_name) ?? data.memberships[0];
      adoptSession(data, joined?.tenant_id);
      router.replace("/devices");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't accept the invitation. Try again.");
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (loadError) {
    body = (
      <AuthCard
        title="This invitation can't be used"
        description={loadError}
        footer={
          <Link href="/login" className="font-medium text-accent hover:underline">
            Go to sign in
          </Link>
        }
      >
      </AuthCard>
    );
  } else if (!preview || status === "loading") {
    body = (
      <AuthCard title="Opening your invitation…">
        <LoadingSkeleton rows={2} rowClassName="h-10" />
      </AuthCard>
    );
  } else {
    const role = toRole(preview.role);
    const intro = (
      <>
        You&apos;re invited to <strong className="text-ink">{preview.tenant_name}</strong> as{" "}
        <strong className="text-ink">{role ? ROLE_LABEL[role] : preview.role}</strong>.
      </>
    );
    if (status === "authenticated") {
      const matches = me != null && me.toLowerCase() === preview.email.toLowerCase();
      body = (
        <AuthCard title={`Join ${preview.tenant_name}`} description={intro}>
          {me == null ? (
            <LoadingSkeleton rows={1} rowClassName="h-10" />
          ) : matches ? (
            <>
              <p className="text-sm text-ink-muted">Signed in as {me}.</p>
              {error && (
                <p role="alert" className="text-sm text-status-error">
                  {error}
                </p>
              )}
              <Button onClick={() => void accept()} disabled={busy} className="h-11 w-full text-[15px]">
                {busy ? "Joining…" : "Accept invitation"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">
                This invitation is for <strong>{preview.email}</strong>, but you&apos;re signed in as {me}.
              </p>
              <Button
                variant="secondary"
                onClick={() => void logout().then(() => router.replace(`/login?next=/invite/${token}`))}
                className="h-11 w-full"
              >
                Sign out and switch account
              </Button>
            </>
          )}
        </AuthCard>
      );
    } else if (preview.account_exists) {
      body = (
        <AuthCard title={`Join ${preview.tenant_name}`} description={intro}>
          <p className="text-sm text-ink-muted">
            {preview.email} already has an account. Sign in to accept.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="grid h-11 place-items-center rounded-md bg-accent text-[15px] font-medium text-on-accent hover:bg-accent-strong"
          >
            Sign in to accept
          </Link>
        </AuthCard>
      );
    } else {
      body = (
        <AuthCard title={`Join ${preview.tenant_name}`} description={intro}>
          <form onSubmit={(e) => void accept(e)} className="flex flex-col gap-3.5">
            <Field label="Email">
              <Input value={preview.email} disabled />
            </Field>
            <Field label="Your name" optional>
              <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Choose a password" hint="At least 8 characters.">
              <Input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-status-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || password.length < 8} className="h-11 w-full text-[15px]">
              {busy ? "Joining…" : "Create account and join"}
            </Button>
          </form>
        </AuthCard>
      );
    }
  }

  return <AuthScreen>{body}</AuthScreen>;
}
