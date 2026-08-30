"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/lib/api-client";
import { buildSketch } from "@/lib/firmware-sketch";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

// The hero element (UX_UI_Description.md §1: "the code block is the hero
// element, not an afterthought") — a ready-to-paste sketch with credentials
// already filled in. Metrics/actuators come from the device's catalog entry
// (empty for a "Legacy" device — buildSketch falls back to one placeholder
// metric and no actuator code, matching this page's original behavior).
function FirmwareSketch({ created }: { created: DeviceCreateResponse }) {
  const [copied, setCopied] = useState(false);
  const { data: catalogEntry } = useApiSWR<CatalogEntryResponse>(
    `/catalog/${created.device.catalog_entry_id}`,
  );
  const sketch = buildSketch({
    tenantSlug: created.tenant_slug,
    deviceSlug: created.device.slug,
    host: typeof window !== "undefined" ? window.location.hostname : "YOUR_SERVER_HOST",
    tls: typeof window !== "undefined" && window.location.protocol === "https:",
    metrics: catalogEntry?.metrics ?? [],
    actuators: catalogEntry?.actuators ?? [],
    credential: created.credential,
  });

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4">
      <p className="text-sm font-medium text-ink">Flash this onto your ESP32</p>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-raised p-3 text-xs text-ink">
        <code>{sketch}</code>
      </pre>
      <Button
        type="button"
        className="mt-3"
        onClick={() => {
          void navigator.clipboard.writeText(sketch).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy sketch"}
      </Button>
    </div>
  );
}

// The payoff moment (UX_UI_Description.md §1: "a live 'waiting for first
// message' state that visibly reacts the instant data arrives"). Polls from
// the moment the device exists — not gated on any copy action, since flashing
// might happen through a path other than this page's own copy buttons.
function WaitingForFirstData({ deviceId }: { deviceId: string }) {
  const { data } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, {
    refreshInterval: 2000,
  });
  const reading = data?.[0];

  if (reading) {
    return (
      <div className="rounded-xl border border-status-online/40 bg-status-online/10 p-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-status-online" aria-hidden />
          <p className="text-sm font-medium text-status-online">Live data received</p>
        </div>
        <p className="mt-2 text-sm text-ink">
          {reading.metric}: <span className="font-mono">{reading.value}</span>
        </p>
        <Link href={`/devices/${deviceId}`} className="mt-3 inline-block text-sm text-accent">
          Continue to device →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-status-pending" aria-hidden />
        <p className="text-sm text-ink">Waiting for first message…</p>
      </div>
      {/* Inline troubleshooting, not a link to docs (UX_UI_Description.md §1). */}
      <p className="mt-2 text-xs text-ink-muted">
        No data yet? Check the board is on the same Wi-Fi, and that the credentials above were
        copied exactly.
      </p>
    </div>
  );
}

export default function NewDevicePage() {
  const api = useApi();
  const searchParams = useSearchParams();
  const prefillCatalogEntryId = searchParams.get("catalog_entry_id");
  const prefillName = searchParams.get("name");
  const { data: catalogEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const [name, setName] = useState(prefillName ?? "");
  const [catalogEntryId, setCatalogEntryId] = useState(prefillCatalogEntryId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<DeviceCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Default to the first entry (a fresh tenant's is always its auto-created
  // "Legacy / Uncategorized" one — devices/service.py — so this is never a
  // catalog-first-blocked empty state). Skipped when a type was already
  // handed in via ?catalog_entry_id= (the Devices list's Duplicate action).
  useEffect(() => {
    if (catalogEntries && catalogEntries.length > 0 && !catalogEntryId) {
      setCatalogEntryId(catalogEntries[0].id);
    }
  }, [catalogEntries, catalogEntryId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<DeviceCreateResponse>("/devices", {
        name,
        catalog_entry_id: catalogEntryId,
      });
      void revalidate("/devices");
      setCreated(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // The credential is shown exactly once and can never be fetched again — make
  // that consequence obvious before the user navigates away
  // (UX_UI_Description.md §1).
  if (created) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-lg font-semibold text-ink">{created.device.name} created</h1>

        <div className="rounded-xl border border-status-pending/40 bg-status-pending-surface p-4">
          <p className="text-sm font-medium text-ink">
            Copy this credential now — it will not be shown again.
          </p>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-ink-muted">Username</dt>
              <dd className="font-mono text-ink">{created.credential.username}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Password</dt>
              <dd className="font-mono text-ink">{created.credential.password}</dd>
            </div>
          </dl>
          <Button
            type="button"
            className="mt-3"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  `username: ${created.credential.username}\npassword: ${created.credential.password}`,
                )
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy credential"}
          </Button>
        </div>

        <Link href={`/devices/${created.device.id}`} className="text-center text-sm text-accent">
          Continue to device →
        </Link>

        <FirmwareSketch created={created} />
        <WaitingForFirstData deviceId={created.device.id} />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <h1 className="text-lg font-semibold text-ink">Add a device</h1>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Name
        <Input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Greenhouse sensor 1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Type
        <Select required value={catalogEntryId} onChange={(e) => setCatalogEntryId(e.target.value)}>
          {!catalogEntries && <option value="">Loading…</option>}
          {catalogEntries?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        <Link href="/devices/templates" className="text-xs text-accent">
          Manage templates →
        </Link>
      </label>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <Button type="submit" size="md" disabled={submitting}>
        {submitting ? "Creating…" : "Create device"}
      </Button>
    </form>
  );
}
