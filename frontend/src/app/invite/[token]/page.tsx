"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { HOME } from "@/lib/landing";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { AuthCard, AuthScreen } from "@/components/auth/AuthCard";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { ApiRequestError, apiClient } from "@/lib/api-client";
import { toRole } from "@/lib/permissions";
import type { components } from "@/types/api";
import { richT, useT } from "@/lib/i18n";

type Preview = components["schemas"]["InvitationPreviewResponse"];
type TokenPairResponse = components["schemas"]["TokenPairResponse"];

/** Accept a workspace invitation (DESIGN.md §8). Outside the (auth) group
 * because a signed-in person accepts here too. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const t = useT();
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
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : t("auth.invite.openFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      router.replace(HOME);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("auth.invite.acceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (loadError) {
    body = (
      <AuthCard
        title={t("auth.invite.unusableTitle")}
        description={loadError}
        footer={
          <Link href="/login" className="font-medium text-accent hover:underline">
            {t("auth.invite.goSignIn")}
          </Link>
        }
      >
      </AuthCard>
    );
  } else if (!preview || status === "loading") {
    body = (
      <AuthCard title={t("auth.invite.opening")}>
        <LoadingSkeleton rows={2} rowClassName="h-10" />
      </AuthCard>
    );
  } else {
    const role = toRole(preview.role);
    const intro = (
      <>
        {richT(t, "auth.invite.intro", {
          workspace: <strong className="text-ink">{preview.tenant_name}</strong>,
          role: <strong className="text-ink">{role ? t(`roles.${role}`) : preview.role}</strong>,
        })}
      </>
    );
    if (status === "authenticated") {
      const matches = me != null && me.toLowerCase() === preview.email.toLowerCase();
      body = (
        <AuthCard title={t("auth.invite.join", { workspace: preview.tenant_name })} description={intro}>
          {me == null ? (
            <LoadingSkeleton rows={1} rowClassName="h-10" />
          ) : matches ? (
            <>
              <p className="text-sm text-ink-muted">{t("auth.invite.signedInAs", { email: me })}</p>
              {error && (
                <p role="alert" className="text-sm text-status-error">
                  {error}
                </p>
              )}
              <Button onClick={() => void accept()} disabled={busy} className="w-full">
                {busy ? t("auth.invite.joining") : t("auth.invite.accept")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">
                {richT(t, "auth.invite.wrongAccount", { invited: <strong>{preview.email}</strong> }, { me })}
              </p>
              <Button
                variant="secondary"
                // Stay here: signed out, this page offers "Create account and
                // join" (or "Sign in to accept" when the email has an account).
                onClick={() => void logout()}
                className="w-full"
              >
                {t("auth.invite.signOutToAccept", { email: preview.email })}
              </Button>
            </>
          )}
        </AuthCard>
      );
    } else if (preview.account_exists) {
      body = (
        <AuthCard title={t("auth.invite.join", { workspace: preview.tenant_name })} description={intro}>
          <p className="text-sm text-ink-muted">{t("auth.invite.hasAccount", { email: preview.email })}</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="grid h-11 place-items-center rounded-md bg-accent text-section font-medium text-on-accent hover:bg-accent-strong"
          >
            {t("auth.invite.signInToAccept")}
          </Link>
        </AuthCard>
      );
    } else {
      body = (
        <AuthCard title={t("auth.invite.join", { workspace: preview.tenant_name })} description={intro}>
          {/* With the Google account for this email: no password to choose. */}
          <GoogleSignIn
            extra={{ invitation_token: token }}
            onSession={(data) => {
              const joined = data.memberships.find((m) => m.tenant_name === preview.tenant_name) ?? data.memberships[0];
              adoptSession(data, joined?.tenant_id);
              router.replace(HOME);
            }}
            onError={setError}
          />
          <form onSubmit={(e) => void accept(e)} className="flex flex-col gap-3.5">
            <Field label={t("auth.email")}>
              <Input value={preview.email} disabled />
            </Field>
            <Field label={t("auth.yourName")} optional>
              <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("auth.invite.choosePassword")} hint={t("auth.atLeast8")}>
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
            <Button type="submit" disabled={busy || password.length < 8} className="w-full">
              {busy ? t("auth.invite.joining") : t("auth.invite.createAndJoin")}
            </Button>
          </form>
        </AuthCard>
      );
    }
  }

  return <AuthScreen>{body}</AuthScreen>;
}
