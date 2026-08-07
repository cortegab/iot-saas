"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type UserResponse = components["schemas"]["UserResponse"];
type MemberResponse = components["schemas"]["MemberResponse"];
type ApiKeyResponse = components["schemas"]["ApiKeyResponse"];
type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];
type TenantRole = "owner" | "admin" | "viewer";

const ROLE_OPTIONS: TenantRole[] = ["viewer", "admin", "owner"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

function AccountSection() {
  const { data, error, isLoading, mutate } = useApiSWR<UserResponse>("/auth/me");

  if (isLoading) return <LoadingSkeleton rows={1} rowClassName="h-12" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load account info."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-ink">{data.email}</p>
      <p className="mt-1 text-xs text-ink-muted">
        Member since {new Date(data.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}

function InviteMemberForm({ onInvited }: { onInvited: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/tenants/members", { email: email.trim(), role });
      setEmail("");
      setRole("viewer");
      onInvited();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add this member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TenantRole)}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Inviting…" : "Invite"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-status-error">
          {error}
        </p>
      )}
    </form>
  );
}

function MemberRow({ member, isAdmin, onChanged }: { member: MemberResponse; isAdmin: boolean; onChanged: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(role: TenantRole) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/tenants/members/${member.user_id}`, { role });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change this member's role.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.email} from this workspace?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/tenants/members/${member.user_id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't remove this member.");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink">{member.email}</span>
        {isAdmin ? (
          <div className="flex items-center gap-3">
            <select
              value={member.role}
              disabled={busy}
              onChange={(e) => void changeRole(e.target.value as TenantRole)}
              className="rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-ink disabled:opacity-60"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="text-sm text-status-error disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        ) : (
          <span className="text-sm text-ink-muted">{member.role}</span>
        )}
      </div>
      {error && <ErrorState message={error} />}
    </li>
  );
}

function TenantMembersSection() {
  const { data: members, error, isLoading, mutate } = useApiSWR<MemberResponse[]>("/tenants/members");
  const isAdmin = useIsAdmin();

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-14" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load members."}
        onRetry={() => void mutate()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isAdmin && <InviteMemberForm onInvited={() => void mutate()} />}

      {!members || members.length === 0 ? (
        <EmptyState title="No members yet" description="This workspace has no members." />
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <MemberRow key={m.user_id} member={m} isAdmin={isAdmin} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateApiKeyForm({ onCreated }: { onCreated: (result: ApiKeyCreateResponse) => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<ApiKeyCreateResponse>("/api-keys", { name: name.trim(), role });
      setName("");
      setRole("viewer");
      onCreated(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create this API key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CI pipeline"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TenantRole)}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create key"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-status-error">
          {error}
        </p>
      )}
    </form>
  );
}

function ApiKeyRow({ apiKey, onChanged }: { apiKey: ApiKeyResponse; onChanged: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!confirm(`Revoke "${apiKey.name}"? Anything using it will stop working immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api-keys/${apiKey.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't revoke this key.");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">{apiKey.name}</p>
          <p className="font-mono text-xs text-ink-muted">{apiKey.key_prefix}••••••••</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-ink-muted">{apiKey.role}</span>
          {apiKey.revoked_at ? (
            <span className="text-xs text-status-error">Revoked</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="text-sm text-status-error disabled:opacity-60"
            >
              Revoke
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        {apiKey.last_used_at
          ? `Last used ${new Date(apiKey.last_used_at).toLocaleString()}`
          : "Never used"}
      </p>
      {error && <ErrorState message={error} />}
    </li>
  );
}

function ApiKeysSection() {
  const { data: keys, error, isLoading, mutate } = useApiSWR<ApiKeyResponse[]>("/api-keys");
  const [revealed, setRevealed] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-16" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load API keys."}
        onRetry={() => void mutate()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {revealed ? (
        // Shown once — mirrors the device-credential reveal in
        // devices/new/page.tsx: explicit copy step before it can be dismissed.
        <div className="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4">
          <p className="text-sm font-medium text-ink">Copy this key now — it will not be shown again.</p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{revealed.key}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.key).then(() => setCopied(true));
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              {copied ? "Copied" : "Copy key"}
            </button>
            <button
              type="button"
              disabled={!copied}
              onClick={() => {
                setRevealed(null);
                setCopied(false);
                void mutate();
              }}
              className="text-sm text-ink-muted disabled:opacity-50"
            >
              {copied ? "Done" : "Copy the key to continue"}
            </button>
          </div>
        </div>
      ) : (
        <CreateApiKeyForm onCreated={setRevealed} />
      )}

      {!keys || keys.length === 0 ? (
        <EmptyState title="No API keys yet" description="Create one to authenticate scripts or external services." />
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const isAdmin = useIsAdmin();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>

      <Section title="Account">
        <AccountSection />
      </Section>

      <Section title="Members">
        <TenantMembersSection />
      </Section>

      {isAdmin && (
        <Section title="API keys">
          <ApiKeysSection />
        </Section>
      )}
    </div>
  );
}
