"use client";

import { useState, type FormEvent } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type ApiKeyResponse = components["schemas"]["ApiKeyResponse"];
type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];
type TenantRole = "owner" | "admin" | "viewer";

const ROLE_OPTIONS: TenantRole[] = ["viewer", "admin", "owner"];

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
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Role
        <Select value={role} onChange={(e) => setRole(e.target.value as TenantRole)}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="md" disabled={submitting}>
        {submitting ? "Creating…" : "Create key"}
      </Button>
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
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!(await confirm(`Revoke "${apiKey.name}"? Anything using it will stop working immediately.`))) return;
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
    <li>
      <Card padding="sm" className="flex flex-col gap-1">
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
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void revoke()}>
                Revoke
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          {apiKey.last_used_at
            ? `Last used ${new Date(apiKey.last_used_at).toLocaleString()}`
            : "Never used"}
        </p>
        {error && <ErrorState message={error} />}
      </Card>
      {dialog}
    </li>
  );
}

export default function TokensSettingsPage() {
  const isAdmin = useIsAdmin();
  const { data: keys, error, isLoading, mutate } = useApiSWR<ApiKeyResponse[]>("/api-keys");
  const [revealed, setRevealed] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isAdmin) {
    return <EmptyState title="Admins only" description="Ask an admin or owner to manage API keys." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {isLoading && <LoadingSkeleton rows={2} rowClassName="h-16" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load API keys."}
          onRetry={() => void mutate()}
        />
      )}

      {revealed ? (
        // Shown once — mirrors the device-credential reveal in devices/new.
        <div className="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4">
          <p className="text-sm font-medium text-ink">Copy this key now — it will not be shown again.</p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{revealed.key}</p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.key).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy key"}
            </Button>
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

      {!isLoading && (!keys || keys.length === 0) && (
        <EmptyState title="No API keys yet" description="Create one to authenticate scripts or external services." />
      )}

      {keys && keys.length > 0 && (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}
