"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

function NewDashboardForm({ onCreated }: { onCreated: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/dashboards", { name: name.trim() });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create this dashboard.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Greenhouse overview"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Creating…" : "New dashboard"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
    </form>
  );
}

function DashboardRow({ dashboard, onDeleted }: { dashboard: DashboardResponse; onDeleted: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Delete "${dashboard.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/dashboards/${dashboard.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't delete this dashboard.");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <Link href={`/dashboards/${dashboard.id}`} className="text-sm font-medium text-ink hover:text-accent">
          {dashboard.name}
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            Updated {new Date(dashboard.updated_at).toLocaleDateString()}
          </span>
          <button type="button" disabled={busy} onClick={() => void remove()} className="text-sm text-status-error disabled:opacity-60">
            Delete
          </button>
        </div>
      </div>
      {error && <ErrorState message={error} />}
    </li>
  );
}

export default function DashboardsPage() {
  const { data: dashboards, error, isLoading, mutate } = useApiSWR<DashboardResponse[]>("/dashboards");

  if (isLoading) return <LoadingSkeleton rows={3} rowClassName="h-16" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load dashboards."}
        onRetry={() => void mutate()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Dashboards</h1>

      <NewDashboardForm onCreated={() => void mutate()} />

      {!dashboards || dashboards.length === 0 ? (
        <EmptyState
          title="No dashboards yet"
          description="Create one and add widgets for the devices you care about most."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {dashboards.map((d) => (
            <DashboardRow key={d.id} dashboard={d} onDeleted={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}
