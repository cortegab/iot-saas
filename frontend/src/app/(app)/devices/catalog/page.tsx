"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { RuleForm } from "@/components/rules/RuleForm";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

const ACTUATOR_VALUE_TYPES: CatalogActuator["value_type"][] = ["bool", "float", "string"];

function MetricRow({
  metric,
  onChange,
  onRemove,
}: {
  metric: CatalogMetric;
  onChange: (next: CatalogMetric) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <input
        required
        value={metric.name}
        onChange={(e) => onChange({ ...metric, name: e.target.value })}
        placeholder="Name, e.g. temperature"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        value={metric.unit ?? ""}
        onChange={(e) => onChange({ ...metric, unit: e.target.value || null })}
        placeholder="Unit, e.g. °C"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        type="number"
        value={metric.min ?? ""}
        onChange={(e) => onChange({ ...metric, min: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="Min"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        type="number"
        value={metric.max ?? ""}
        onChange={(e) => onChange({ ...metric, max: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="Max"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <button type="button" onClick={onRemove} className="text-sm text-status-error">
        Remove
      </button>
    </div>
  );
}

function ActuatorRow({
  actuator,
  onChange,
  onRemove,
}: {
  actuator: CatalogActuator;
  onChange: (next: CatalogActuator) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
      <input
        required
        value={actuator.name}
        onChange={(e) => onChange({ ...actuator, name: e.target.value })}
        placeholder="Name, e.g. fan1"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <select
        value={actuator.value_type}
        onChange={(e) => onChange({ ...actuator, value_type: e.target.value as CatalogActuator["value_type"] })}
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      >
        {ACTUATOR_VALUE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRemove} className="text-sm text-status-error">
        Remove
      </button>
    </div>
  );
}

function NewCatalogEntryForm({ onCreated }: { onCreated: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [metrics, setMetrics] = useState<CatalogMetric[]>([]);
  const [actuators, setActuators] = useState<CatalogActuator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/catalog", { name: name.trim(), metrics, actuators });
      setName("");
      setMetrics([]);
      setActuators([]);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create this catalog entry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Type name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Temperature Sensor v2"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">Metrics</legend>
        {metrics.map((m, i) => (
          <MetricRow
            key={i}
            metric={m}
            onChange={(next) => setMetrics(metrics.map((mm, j) => (i === j ? next : mm)))}
            onRemove={() => setMetrics(metrics.filter((_, j) => i !== j))}
          />
        ))}
        <button
          type="button"
          onClick={() => setMetrics([...metrics, { name: "", unit: null, data_type: "float", min: null, max: null }])}
          className="self-start text-sm text-accent"
        >
          + Add metric
        </button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">Actuators</legend>
        {actuators.map((a, i) => (
          <ActuatorRow
            key={i}
            actuator={a}
            onChange={(next) => setActuators(actuators.map((aa, j) => (i === j ? next : aa)))}
            onRemove={() => setActuators(actuators.filter((_, j) => i !== j))}
          />
        ))}
        <button
          type="button"
          onClick={() => setActuators([...actuators, { name: "", value_type: "bool", allowed_values: null }])}
          className="self-start text-sm text-accent"
        >
          + Add actuator
        </button>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create catalog entry"}
      </button>
    </form>
  );
}

/** Rule creation lives here rather than on the device detail page — a
 * rule's condition vocabulary comes from the catalog entry's declared
 * metrics, so authoring starts from the type and picks a device instance
 * second (a rule still targets exactly one device — CLAUDE.md's rule schema
 * is scoped that way, so this can't skip the picker step entirely). */
function CreateRuleForEntry({ entry }: { entry: CatalogEntryResponse }) {
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const [open, setOpen] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const matchingDevices = (devices ?? []).filter((d) => d.catalog_entry_id === entry.id);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-accent">
        Create rule
      </button>
    );
  }

  if (deviceId) {
    return (
      <div className="mt-2">
        <RuleForm
          deviceId={deviceId}
          onSaved={() => {
            setOpen(false);
            setDeviceId("");
          }}
          onCancel={() => setDeviceId("")}
        />
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      {matchingDevices.length === 0 ? (
        <span className="text-sm text-ink-muted">No devices use this type yet.</span>
      ) : (
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-ink"
        >
          <option value="" disabled>
            Choose a device…
          </option>
          {matchingDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-muted">
        Cancel
      </button>
    </div>
  );
}

function CatalogEntryRow({ entry, onDeleted }: { entry: CatalogEntryResponse; onDeleted: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/catalog/${entry.id}`);
      onDeleted();
    } catch (err) {
      // 409 when devices still reference this entry — surfaced as-is, the
      // backend's detail message already explains the block.
      setError(err instanceof ApiRequestError ? err.message : "Couldn't delete this catalog entry.");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink">
            {entry.name}
            {entry.is_legacy && (
              <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
                Legacy
              </span>
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {entry.metrics.length} metric{entry.metrics.length === 1 ? "" : "s"} ·{" "}
            {entry.actuators.length} actuator{entry.actuators.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CreateRuleForEntry entry={entry} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="text-sm text-status-error disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      </div>
      {error && <ErrorState message={error} />}
    </li>
  );
}

export default function DeviceCatalogPage() {
  const { data: entries, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse[]>("/catalog");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Device catalog</h1>
          <p className="text-sm text-ink-muted">
            Define device types — their metrics and actuators — for devices to instantiate from.
          </p>
        </div>
        <Link href="/devices" className="text-sm text-ink-muted hover:text-ink">
          ← Devices
        </Link>
      </div>

      <NewCatalogEntryForm onCreated={() => void mutate()} />

      {isLoading && <LoadingSkeleton rows={3} rowClassName="h-16" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load the catalog."}
          onRetry={() => void mutate()}
        />
      )}

      {entries && entries.length === 0 && (
        <EmptyState title="No catalog entries yet" description="Create one to define a device type." />
      )}

      {entries && entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <CatalogEntryRow key={e.id} entry={e} onDeleted={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}
