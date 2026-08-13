"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];

const ACTUATOR_VALUE_TYPES: CatalogActuator["value_type"][] = ["bool", "float", "string"];

const METRIC_GRID_COLS = "sm:grid-cols-[1.5fr_1fr_0.8fr_0.7fr_0.7fr_0.7fr_auto]";
const METRIC_HEADERS = ["Name", "Key", "Unit", "Decimals", "Min", "Max"];

/** Column headers for the `MetricRow`/`ActuatorRow` grids below — the shared-header pattern
 * `Table.tsx` uses for its `<thead>`, reused here since these rows are effectively an inline
 * editable table. A `<label>` per row would work for one row but doubles the vertical space
 * per row once there are several; a header shown once above the list scales better. Hidden
 * below `sm` since the rows themselves collapse to a single stacked column there, where a
 * header row would just be 6 labels stacked above 6 stacked inputs. */
function GridHeaders({ labels, gridCols }: { labels: string[]; gridCols: string }) {
  return (
    <div className={`hidden gap-2 px-2 text-xs font-medium text-ink-muted sm:grid ${gridCols}`}>
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

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
    <div className={`grid grid-cols-1 gap-2 rounded-md border border-border p-2 ${METRIC_GRID_COLS}`}>
      <input
        required
        aria-label="Metric name"
        value={metric.name}
        onChange={(e) => onChange({ ...metric, name: e.target.value })}
        placeholder="Name, e.g. Temperature"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        aria-label="Metric key"
        value={metric.key ?? ""}
        onChange={(e) => onChange({ ...metric, key: e.target.value || null })}
        placeholder="Key, e.g. temperature"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        aria-label="Unit"
        value={metric.unit ?? ""}
        onChange={(e) => onChange({ ...metric, unit: e.target.value || null })}
        placeholder="Unit, e.g. °C"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        type="number"
        min={0}
        max={10}
        aria-label="Decimals"
        value={metric.decimals ?? ""}
        onChange={(e) =>
          onChange({ ...metric, decimals: e.target.value === "" ? null : Number(e.target.value) })
        }
        placeholder="Decimals"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        type="number"
        aria-label="Minimum value"
        value={metric.min ?? ""}
        onChange={(e) => onChange({ ...metric, min: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="Min"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <input
        type="number"
        aria-label="Maximum value"
        value={metric.max ?? ""}
        onChange={(e) => onChange({ ...metric, max: e.target.value === "" ? null : Number(e.target.value) })}
        placeholder="Max"
        className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
      />
      <Button type="button" variant="destructive" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

const ACTUATOR_GRID_COLS = "sm:grid-cols-[1.5fr_1fr_0.8fr_auto]";
const ACTUATOR_HEADERS = ["Name", "Key", "Value type"];

function ActuatorRow({
  actuator,
  onChange,
  onRemove,
}: {
  actuator: CatalogActuator;
  onChange: (next: CatalogActuator) => void;
  onRemove: () => void;
}) {
  const isBool = actuator.value_type === "bool";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className={`grid grid-cols-1 gap-2 ${ACTUATOR_GRID_COLS}`}>
        <input
          required
          aria-label="Actuator name"
          value={actuator.name}
          onChange={(e) => onChange({ ...actuator, name: e.target.value })}
          placeholder="Name, e.g. Fan"
          className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
        />
        <input
          aria-label="Actuator key"
          value={actuator.key ?? ""}
          onChange={(e) => onChange({ ...actuator, key: e.target.value || null })}
          placeholder="Key, e.g. fan1"
          className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
        />
        <select
          aria-label="Value type"
          value={actuator.value_type}
          onChange={(e) =>
            onChange({ ...actuator, value_type: e.target.value as CatalogActuator["value_type"] })
          }
          className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
        >
          {ACTUATOR_VALUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button type="button" variant="destructive" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {/* Command-value mapping only makes sense for a two-state actuator
          (spec's "ON -> 1", "OFF -> 0") — hidden for float/string types. */}
      {isBool && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            ON value
            <input
              value={actuator.on_value == null ? "" : String(actuator.on_value)}
              onChange={(e) => onChange({ ...actuator, on_value: e.target.value || null })}
              placeholder="e.g. 1"
              className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            OFF value
            <input
              value={actuator.off_value == null ? "" : String(actuator.off_value)}
              onChange={(e) => onChange({ ...actuator, off_value: e.target.value || null })}
              placeholder="e.g. 0"
              className="rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "metrics", label: "Metrics" },
  { id: "actuators", label: "Actuators" },
];

export function CatalogEntryForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  /** For edit: the entry being edited. For create: an optional entry to
   * duplicate from (name/metrics/actuators copied, id/status/is_legacy not). */
  initial?: CatalogEntryResponse;
}) {
  const api = useApi();
  const router = useRouter();
  const [tab, setTab] = useState("general");
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<CatalogEntryResponse["status"]>(initial?.status ?? "active");
  const [metrics, setMetrics] = useState<CatalogMetric[]>(initial?.metrics ?? []);
  const [actuators, setActuators] = useState<CatalogActuator[]>(initial?.actuators ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const created = await api.post<CatalogEntryResponse>("/catalog", {
          name: name.trim(),
          metrics,
          actuators,
        });
        void revalidate("/catalog");
        router.push(`/devices/templates/${created.id}`);
      } else if (initial) {
        await api.patch(`/catalog/${initial.id}`, { name: name.trim(), metrics, actuators, status });
        void revalidate("/catalog");
        router.push("/devices/templates");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save this template.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel id="general" active={tab}>
        <label className="flex max-w-sm flex-col gap-1 text-sm text-ink-muted">
          Name
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ESP32 Environment" />
        </label>
        {mode === "edit" && (
          <label className="flex max-w-sm flex-col gap-1 text-sm text-ink-muted">
            Status
            <Select value={status} onChange={(e) => setStatus(e.target.value as CatalogEntryResponse["status"])}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </Select>
          </label>
        )}
      </TabPanel>

      <TabPanel id="metrics" active={tab}>
        <div className="flex flex-col gap-2">
          {metrics.length > 0 && <GridHeaders labels={METRIC_HEADERS} gridCols={METRIC_GRID_COLS} />}
          {metrics.map((m, i) => (
            <MetricRow
              key={i}
              metric={m}
              onChange={(next) => setMetrics(metrics.map((mm, j) => (i === j ? next : mm)))}
              onRemove={() => setMetrics(metrics.filter((_, j) => i !== j))}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              setMetrics([
                ...metrics,
                { name: "", key: null, unit: null, data_type: "float", decimals: null, min: null, max: null },
              ])
            }
          >
            + Add metric
          </Button>
        </div>
      </TabPanel>

      <TabPanel id="actuators" active={tab}>
        <div className="flex flex-col gap-2">
          {actuators.length > 0 && <GridHeaders labels={ACTUATOR_HEADERS} gridCols={ACTUATOR_GRID_COLS} />}
          {actuators.map((a, i) => (
            <ActuatorRow
              key={i}
              actuator={a}
              onChange={(next) => setActuators(actuators.map((aa, j) => (i === j ? next : aa)))}
              onRemove={() => setActuators(actuators.filter((_, j) => i !== j))}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              setActuators([
                ...actuators,
                { name: "", key: null, value_type: "bool", allowed_values: null, on_value: null, off_value: null },
              ])
            }
          >
            + Add actuator
          </Button>
        </div>
      </TabPanel>

      {error && <ErrorState message={error} />}

      <div className="flex gap-3 border-t border-border pt-4">
        <Button type="submit" size="md" disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={() => router.push("/devices/templates")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
