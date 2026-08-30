"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { UnitField } from "@/components/catalog/UnitField";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { slugify } from "@/lib/slug";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];

/** Client-only stable row identity. The metric/actuator lists carry
 * uncontrolled child state (the unit combobox's open/search state), so a
 * plain array-index `key` would leak that state to a neighbour when a row
 * above is removed. `_uid` is stripped before submit. */
type MetricDraft = CatalogMetric & { _uid: string };
type ActuatorDraft = CatalogActuator & { _uid: string };

const ACTUATOR_VALUE_TYPES: CatalogActuator["value_type"][] = ["bool", "float", "string"];
const ACTUATOR_VALUE_TYPE_LABELS: Record<CatalogActuator["value_type"], string> = {
  bool: "Boolean",
  float: "Number",
  string: "Text",
};

const KEY_HINT = "Auto-generated from the name — edit to override.";

// The unit combobox trigger is a <button>, not an <input>, so it can't inherit
// the `Input` primitive. Keep this in sync with `<Input compact>`'s box so the
// two line up in the row grid.
const FIELD_BOX = "rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-ink text-left";

function newMetric(): MetricDraft {
  return {
    _uid: crypto.randomUUID(),
    name: "",
    key: null,
    unit: null,
    data_type: "float",
    decimals: null,
    min: null,
    max: null,
  };
}

function newActuator(): ActuatorDraft {
  return {
    _uid: crypto.randomUUID(),
    name: "",
    key: null,
    value_type: "bool",
    allowed_values: null,
    on_value: null,
    off_value: null,
  };
}

function toMetric(m: MetricDraft): CatalogMetric {
  return {
    name: m.name,
    key: m.key,
    unit: m.unit,
    data_type: m.data_type,
    decimals: m.decimals,
    min: m.min,
    max: m.max,
  };
}

function toActuator(a: ActuatorDraft): CatalogActuator {
  return {
    name: a.name,
    key: a.key,
    value_type: a.value_type,
    allowed_values: a.allowed_values,
    on_value: a.on_value,
    off_value: a.off_value,
  };
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
  const isFlag = metric.data_type === "bool";
  return (
    <Card padding="sm">
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            isFlag ? "sm:grid-cols-[1.6fr_1fr_1fr]" : "sm:grid-cols-[1.6fr_1fr_1fr_1.2fr]",
          )}
        >
          <Field label="Name">
            <Input
              compact
              required
              value={metric.name}
              onChange={(e) => {
                const name = e.target.value;
                // Auto-fill the wire key from the display name until the author
                // manually edits Key themselves — a blank key stays the "not yet
                // set" signal, so this stops overwriting the moment they type
                // into the Key input directly.
                const key = metric.key ? metric.key : slugify(name) || null;
                onChange({ ...metric, name, key });
              }}
              placeholder="e.g. Temperature"
            />
          </Field>
          <Field label="Key" hint={KEY_HINT}>
            <Input
              compact
              value={metric.key ?? ""}
              onChange={(e) => onChange({ ...metric, key: e.target.value || null })}
              placeholder="e.g. temperature"
            />
          </Field>
          <Field label="Type">
            <Select
              compact
              value={metric.data_type}
              onChange={(e) => {
                // A flag has no unit or range — clear those so a re-typed metric
                // doesn't carry stale numeric config, and pin 0..1 for anything
                // downstream that still reads min/max.
                if (e.target.value === "bool") {
                  onChange({ ...metric, data_type: "bool", unit: null, decimals: 0, min: 0, max: 1 });
                } else {
                  onChange({ ...metric, data_type: "float" });
                }
              }}
            >
              <option value="float">Number</option>
              <option value="bool">On/off flag</option>
            </Select>
          </Field>
          {!isFlag && (
            <Field label="Unit">
              <UnitField
                value={metric.unit ?? null}
                onChange={(unit) => onChange({ ...metric, unit })}
                className={FIELD_BOX}
              />
            </Field>
          )}
        </div>

        {isFlag ? (
          <p className="text-xs text-ink-muted">On/off flag — value is 0 or 1, no unit or range.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Decimals">
              <Input
                compact
                type="number"
                min={0}
                max={10}
                value={metric.decimals ?? ""}
                onChange={(e) =>
                  onChange({ ...metric, decimals: e.target.value === "" ? null : Number(e.target.value) })
                }
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="Min">
              <Input
                compact
                type="number"
                value={metric.min ?? ""}
                onChange={(e) => onChange({ ...metric, min: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="Min"
              />
            </Field>
            <Field label="Max">
              <Input
                compact
                type="number"
                value={metric.max ?? ""}
                onChange={(e) => onChange({ ...metric, max: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="Max"
              />
            </Field>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="destructive" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
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
  const isBool = actuator.value_type === "bool";
  return (
    <Card padding="sm">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.6fr_1fr_1fr]">
          <Field label="Name">
            <Input
              compact
              required
              value={actuator.name}
              onChange={(e) => {
                const name = e.target.value;
                const key = actuator.key ? actuator.key : slugify(name) || null;
                onChange({ ...actuator, name, key });
              }}
              placeholder="e.g. Fan"
            />
          </Field>
          <Field label="Key" hint={KEY_HINT}>
            <Input
              compact
              value={actuator.key ?? ""}
              onChange={(e) => onChange({ ...actuator, key: e.target.value || null })}
              placeholder="e.g. fan1"
            />
          </Field>
          <Field label="Value type">
            <Select
              compact
              value={actuator.value_type}
              onChange={(e) =>
                onChange({ ...actuator, value_type: e.target.value as CatalogActuator["value_type"] })
              }
            >
              {ACTUATOR_VALUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTUATOR_VALUE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Command-value mapping only makes sense for a two-state actuator
            (spec's "ON -> 1", "OFF -> 0") — hidden for number/text types. */}
        {isBool && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ON value">
              <Input
                compact
                value={actuator.on_value == null ? "" : String(actuator.on_value)}
                onChange={(e) => onChange({ ...actuator, on_value: e.target.value || null })}
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="OFF value">
              <Input
                compact
                value={actuator.off_value == null ? "" : String(actuator.off_value)}
                onChange={(e) => onChange({ ...actuator, off_value: e.target.value || null })}
                placeholder="e.g. 0"
              />
            </Field>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="destructive" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
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
  const [metrics, setMetrics] = useState<MetricDraft[]>(() =>
    (initial?.metrics ?? []).map((m) => ({ ...m, _uid: crypto.randomUUID() })),
  );
  const [actuators, setActuators] = useState<ActuatorDraft[]>(() =>
    (initial?.actuators ?? []).map((a) => ({ ...a, _uid: crypto.randomUUID() })),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payloadMetrics = metrics.map(toMetric);
    const payloadActuators = actuators.map(toActuator);
    try {
      if (mode === "create") {
        const created = await api.post<CatalogEntryResponse>("/catalog", {
          name: name.trim(),
          metrics: payloadMetrics,
          actuators: payloadActuators,
        });
        void revalidate("/catalog");
        router.push(`/devices/templates/${created.id}`);
      } else if (initial) {
        await api.patch(`/catalog/${initial.id}`, {
          name: name.trim(),
          metrics: payloadMetrics,
          actuators: payloadActuators,
          status,
        });
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
        {/* All fields in this form run `compact` (text-sm) — the General inputs
            match the dense Metrics/Actuators rows rather than towering over
            them at the inherited 16px default. */}
        <Card padding="md">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                compact
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ESP32 Environment"
              />
            </Field>
            {mode === "edit" && (
              <Field label="Status">
                <Select
                  compact
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CatalogEntryResponse["status"])}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </Select>
              </Field>
            )}
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="metrics" active={tab}>
        <Callout>Tap the Unit field to search a categorized catalog, or type your own.</Callout>
        <div className="flex flex-col gap-3">
          {metrics.length === 0 && (
            <p className="text-sm text-ink-muted">No metrics yet — add one below.</p>
          )}
          {metrics.map((m) => (
            <MetricRow
              key={m._uid}
              metric={m}
              onChange={(next) =>
                setMetrics(metrics.map((mm) => (mm._uid === m._uid ? { ...next, _uid: mm._uid } : mm)))
              }
              onRemove={() => setMetrics(metrics.filter((mm) => mm._uid !== m._uid))}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => setMetrics([...metrics, newMetric()])}
          >
            <Plus size={14} aria-hidden />
            Add metric
          </Button>
        </div>
      </TabPanel>

      <TabPanel id="actuators" active={tab}>
        <Callout>The ON / OFF value is the exact payload the device receives on the wire.</Callout>
        <div className="flex flex-col gap-3">
          {actuators.length === 0 && (
            <p className="text-sm text-ink-muted">No actuators yet — add one below.</p>
          )}
          {actuators.map((a) => (
            <ActuatorRow
              key={a._uid}
              actuator={a}
              onChange={(next) =>
                setActuators(actuators.map((aa) => (aa._uid === a._uid ? { ...next, _uid: aa._uid } : aa)))
              }
              onRemove={() => setActuators(actuators.filter((aa) => aa._uid !== a._uid))}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => setActuators([...actuators, newActuator()])}
          >
            <Plus size={14} aria-hidden />
            Add actuator
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
