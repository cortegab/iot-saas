"use client";

import { useState, type ReactNode } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type UserResponse = components["schemas"]["UserResponse"];
type TenantResponse = components["schemas"]["TenantResponse"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

function OrganizationSection() {
  const api = useApi();
  const { memberships, currentTenantId } = useAuth();
  // Rename is owner-only (tenants/router.py's require_role(OWNER)) — an admin
  // can view this page but shouldn't see a control that would just 403.
  const isOwner = memberships.find((m) => m.tenant_id === currentTenantId)?.role === "owner";
  const { data, error, isLoading, mutate } = useApiSWR<TenantResponse>("/tenants/current");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (isLoading) return <LoadingSkeleton rows={1} rowClassName="h-16" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load organization info."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data) return null;

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await api.patch("/tenants/current", { name: name.trim() });
      setEditing(false);
      void mutate();
    } catch (err) {
      // 403 if the caller isn't the owner — the backend is the real gate.
      setSaveError(err instanceof ApiRequestError ? err.message : "Couldn't rename this workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input compact autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">{data.name}</p>
            <p className="text-sm text-ink-muted">Slug: {data.slug}</p>
            <p className="mt-1 text-xs text-ink-muted">
              Created {new Date(data.created_at).toLocaleDateString()}
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => {
                setName(data.name);
                setEditing(true);
              }}
              className="text-sm text-ink-muted hover:text-ink"
            >
              Rename
            </button>
          )}
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
    </Card>
  );
}

function AccountSection() {
  const api = useApi();
  const { data, error, isLoading, mutate } = useApiSWR<UserResponse>("/auth/me");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await api.patch("/auth/me", { name: name.trim() || null });
      setEditing(false);
      void mutate();
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input compact autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink">{data.name || <span className="text-ink-muted">No name set</span>}</p>
            <p className="text-sm text-ink-muted">{data.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setName(data.name ?? "");
              setEditing(true);
            }}
            className="text-sm text-ink-muted hover:text-ink"
          >
            {data.name ? "Edit" : "Add name"}
          </button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
    </Card>
  );
}

export default function OrganizationSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-ink">Organization</h1>

      <Section title="Workspace">
        <OrganizationSection />
      </Section>

      <Section title="Your account">
        <AccountSection />
      </Section>
    </div>
  );
}
