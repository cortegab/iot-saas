"use client";

/**
 * Builds/edits a rule whose condition is a *flat* list of predicate rows
 * combined by one top-level AND/OR toggle — but each row can read a metric
 * from a *different device*, and the action can target a different device
 * again (the multi-device rule engine). A rule whose condition is a real
 * nested tree (only reachable via direct API use) falls back to a read-only
 * view here — see NotFlatConditionNotice.
 *
 * Nested group editing is still a deliberate scope cut (the visual builder is
 * the place for that); this form covers "IF A.x AND B.y THEN command D".
 */

import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/cn";
import { ApiRequestError } from "@/lib/api-client";
import { wireId } from "@/lib/wire-id";
import {
  RuleSummary,
  releasePoint,
  type ConditionLeaf,
  type ConditionNode,
  type RhsSpec,
} from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type ActionType = "actuator_command" | "notification" | "webhook";
type ValueKind = "boolean" | "number" | "text";
type Combinator = "AND" | "OR";
type TriggerType = "metric" | "schedule" | "manual" | "device_status";
type DeviceStatusTransition = "connected" | "disconnected";
/** How many rhs values an operator takes, and of what shape — drives
 * PredicateRow's value-column render. "one" additionally supports either a
 * static number or another device's metric (see RhsKind below). */
type OperatorArity = "none" | "one" | "range" | "set";
type RhsKind = "static" | "metric";

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Every 15 min", cron: "*/15 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 08:00", cron: "0 8 * * *" },
];

interface LeafDraft {
  /** Stable client-only key so a per-row disclosure's state doesn't leak to
   * a neighbour when a row above it is removed. Never sent. */
  uid: string;
  deviceId: string;
  metric: string;
  operator: string;
  hysteresis: number;
  // rhs — only the fields matching the operator's arity/kind are read when
  // building the wire condition; the rest just sit inert in the draft so
  // switching operators back and forth doesn't lose what was typed.
  rhsKind: RhsKind;
  value: number;
  low: number;
  high: number;
  /** Comma-separated — parsed to number[] on build (in/not_in). */
  setText: string;
  rhsDeviceId: string;
  rhsMetric: string;
}

interface WireOption {
  id: string;
  label: string;
}

const OPERATORS: { value: string; label: string }[] = [
  { value: ">", label: "> above" },
  { value: ">=", label: "≥ at or above" },
  { value: "<", label: "< below" },
  { value: "<=", label: "≤ at or below" },
  { value: "==", label: "= equal to" },
  { value: "!=", label: "≠ different from" },
  { value: "between", label: "between" },
  { value: "not_between", label: "outside" },
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is none of" },
  { value: "changed", label: "changes" },
  { value: "increased", label: "increases" },
  { value: "decreased", label: "decreases" },
];

const OPERATOR_ARITY: Record<string, OperatorArity> = {
  ">": "one",
  ">=": "one",
  "<": "one",
  "<=": "one",
  "==": "one",
  "!=": "one",
  between: "range",
  not_between: "range",
  in: "set",
  not_in: "set",
  changed: "none",
  increased: "none",
  decreased: "none",
};

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-ink-muted";

const TYPE_TO_KIND: Record<CatalogActuator["value_type"], ValueKind> = {
  bool: "boolean",
  float: "number",
  string: "text",
};
const VALUE_TYPE_WORD: Record<CatalogActuator["value_type"], string> = {
  bool: "boolean",
  float: "numeric",
  string: "text",
};

// Safe, non-zero starting points (a hardware-safety requirement).
const DEFAULT_FOR_DURATION = 10;
const DEFAULT_HYSTERESIS = 1;
// Mirrors backend schemas._HYSTERESIS_OPERATORS — the API rejects hysteresis on any other operator.
const HYSTERESIS_OPERATORS = new Set([">", ">=", "<", "<="]);
const DEFAULT_COOLDOWN = 60;

function newUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());
}

function emptyPredicate(deviceId: string): LeafDraft {
  return {
    uid: newUid(),
    deviceId,
    metric: "",
    operator: ">",
    hysteresis: DEFAULT_HYSTERESIS,
    rhsKind: "static",
    value: 0,
    low: 0,
    high: 0,
    setText: "",
    rhsDeviceId: "",
    rhsMetric: "",
  };
}

function isFlatCondition(condition: ConditionNode | null): boolean {
  return condition == null || condition.kind === "leaf" || condition.predicates.every((p) => p.kind === "leaf");
}

function leafDevice(leaf: ConditionLeaf, fallback: string): string {
  const raw = (leaf as { device_id?: string | null }).device_id;
  return typeof raw === "string" && raw ? raw : fallback;
}

function draftsFromCondition(
  condition: ConditionNode | null,
  fallbackDevice: string,
): { predicates: LeafDraft[]; combinator: Combinator } {
  const toDraft = (leaf: ConditionLeaf): LeafDraft => {
    const base = {
      uid: newUid(),
      deviceId: leafDevice(leaf, fallbackDevice),
      metric: leaf.metric,
      operator: leaf.operator,
      hysteresis: leaf.hysteresis,
    };
    const rhs = leaf.rhs;
    if (rhs == null) {
      return { ...base, rhsKind: "static", value: 0, low: 0, high: 0, setText: "", rhsDeviceId: "", rhsMetric: "" };
    }
    if (rhs.source === "range") {
      return { ...base, rhsKind: "static", value: 0, low: rhs.low, high: rhs.high, setText: "", rhsDeviceId: "", rhsMetric: "" };
    }
    if (rhs.source === "set") {
      return { ...base, rhsKind: "static", value: 0, low: 0, high: 0, setText: rhs.values.join(", "), rhsDeviceId: "", rhsMetric: "" };
    }
    if (rhs.source === "metric") {
      return { ...base, rhsKind: "metric", value: 0, low: 0, high: 0, setText: "", rhsDeviceId: rhs.device_id, rhsMetric: rhs.metric };
    }
    return { ...base, rhsKind: "static", value: rhs.value, low: 0, high: 0, setText: "", rhsDeviceId: "", rhsMetric: "" };
  };
  if (condition == null) return { predicates: [], combinator: "AND" };
  if (condition.kind === "leaf") return { predicates: [toDraft(condition)], combinator: "AND" };
  return {
    predicates: (condition.predicates as ConditionLeaf[]).map(toDraft),
    combinator: condition.op,
  };
}

function buildRhs(p: LeafDraft): RhsSpec | null {
  const arity = OPERATOR_ARITY[p.operator] ?? "one";
  if (arity === "none") return null;
  if (arity === "range") return { source: "range", low: p.low, high: p.high };
  if (arity === "set") {
    const values = p.setText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    return { source: "set", values };
  }
  if (p.rhsKind === "metric") return { source: "metric", device_id: p.rhsDeviceId, metric: p.rhsMetric };
  return { source: "static", value: p.value };
}

function buildCondition(predicates: LeafDraft[], combinator: Combinator): ConditionNode | null {
  if (predicates.length === 0) return null;
  const leaves = predicates.map(
    (p) =>
      ({
        kind: "leaf",
        device_id: p.deviceId,
        metric: p.metric,
        operator: p.operator,
        rhs: buildRhs(p),
        hysteresis: HYSTERESIS_OPERATORS.has(p.operator) ? p.hysteresis : 0,
      }) as ConditionLeaf,
  );
  if (leaves.length === 1) return leaves[0];
  return { kind: "group", op: combinator, predicates: leaves };
}

function NumberSafetyField({
  label,
  hint,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <Field
      label={label}
      hint={
        <>
          {hint}
          {value < min && (
            <span className="block text-status-pending">
              Low values make relays cycle rapidly on noisy readings — consider {min} or higher.
            </span>
          )}
        </>
      }
    >
      <Input
        compact
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function DeviceSelect({
  value,
  devices,
  onChange,
  ariaLabel,
}: {
  value: string;
  devices: DeviceResponse[];
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select compact aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a device…
      </option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

function MetricControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: WireOption[];
  onChange: (metric: string) => void;
}) {
  if (options.length === 0) {
    return (
      <Input
        compact
        placeholder="metric name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Select compact value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a metric…
      </option>
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}

function RhsValueControl({
  predicate,
  onChange,
}: {
  predicate: LeafDraft;
  onChange: (next: LeafDraft) => void;
}) {
  const arity = OPERATOR_ARITY[predicate.operator] ?? "one";
  if (arity === "none") {
    return <span className="flex h-9 items-center text-sm text-ink-muted">—</span>;
  }
  if (arity === "range") {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          compact
          type="number"
          step="any"
          aria-label="Low"
          value={predicate.low}
          onChange={(e) => onChange({ ...predicate, low: Number(e.target.value) })}
        />
        <span className="text-xs text-ink-muted">–</span>
        <Input
          compact
          type="number"
          step="any"
          aria-label="High"
          value={predicate.high}
          onChange={(e) => onChange({ ...predicate, high: Number(e.target.value) })}
        />
      </div>
    );
  }
  if (arity === "set") {
    return (
      <Input
        compact
        placeholder="e.g. 1, 2, 3"
        value={predicate.setText}
        onChange={(e) => onChange({ ...predicate, setText: e.target.value })}
      />
    );
  }
  // arity "one" — a static number (the common case) unless switched to metric mode.
  if (predicate.rhsKind === "metric") return null; // rendered below the main grid instead
  return (
    <Input
      compact
      type="number"
      step="any"
      value={predicate.value}
      onChange={(e) => onChange({ ...predicate, value: Number(e.target.value) })}
    />
  );
}

function PredicateRow({
  predicate,
  devices,
  metricOptions,
  rhsMetricOptions,
  onChange,
  onRemove,
  removable,
}: {
  predicate: LeafDraft;
  devices: DeviceResponse[];
  metricOptions: WireOption[];
  rhsMetricOptions: WireOption[];
  onChange: (next: LeafDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(predicate.hysteresis > 0);
  const arity = OPERATOR_ARITY[predicate.operator] ?? "one";
  const canCompareToMetric = arity === "one";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.5fr_1.5fr_1.2fr_1fr_auto]">
        <Field label="Device">
          <DeviceSelect
            ariaLabel="Condition device"
            value={predicate.deviceId}
            devices={devices}
            onChange={(deviceId) => onChange({ ...predicate, deviceId, metric: "" })}
          />
        </Field>
        <Field label="Metric">
          <MetricControl
            value={predicate.metric}
            options={metricOptions}
            onChange={(metric) => onChange({ ...predicate, metric })}
          />
        </Field>
        <Field label="Comparison">
          <Select
            compact
            value={predicate.operator}
            onChange={(e) => onChange({ ...predicate, operator: e.target.value })}
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value">
          <RhsValueControl predicate={predicate} onChange={onChange} />
        </Field>
        {removable && (
          <div className="flex items-end">
            <Button type="button" variant="destructive" onClick={onRemove}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {canCompareToMetric && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="self-start text-xs"
            onClick={() =>
              onChange({ ...predicate, rhsKind: predicate.rhsKind === "metric" ? "static" : "metric" })
            }
          >
            {predicate.rhsKind === "metric" ? "Compare to a fixed value instead" : "Compare to another device instead"}
          </Button>
          {predicate.rhsKind === "metric" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Device">
                <DeviceSelect
                  ariaLabel="Comparison device"
                  value={predicate.rhsDeviceId}
                  devices={devices}
                  onChange={(rhsDeviceId) => onChange({ ...predicate, rhsDeviceId, rhsMetric: "" })}
                />
              </Field>
              <Field label="Metric">
                <MetricControl
                  value={predicate.rhsMetric}
                  options={rhsMetricOptions}
                  onChange={(rhsMetric) => onChange({ ...predicate, rhsMetric })}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {HYSTERESIS_OPERATORS.has(predicate.operator) && (
        <div>
          <Button
            type="button"
            variant="ghost"
            className="text-xs"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </Button>
          {showAdvanced && (
            <div className="mt-1 max-w-xs">
              <Field
                label="Hysteresis"
                hint="How far this reading must fall back past the threshold before the condition counts as cleared and the rule can fire again."
              >
                <Input
                  compact
                  type="number"
                  min={0}
                  step="any"
                  value={predicate.hysteresis}
                  onChange={(e) => onChange({ ...predicate, hysteresis: Number(e.target.value) })}
                />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotFlatConditionNotice({ rule, onCancel }: { rule: RuleResponse; onCancel: () => void }) {
  return (
    <Card padding="md">
      <div className="flex flex-col gap-3">
        <RuleSummary rule={rule} />
        <Callout tone="warning">
          This rule has a nested condition structure that isn&apos;t editable here — it was created
          directly through the API. Delete and recreate it to use this form.
        </Callout>
        <Button type="button" variant="secondary" size="md" className="self-start" onClick={onCancel}>
          Close
        </Button>
      </div>
    </Card>
  );
}

export function RuleForm({
  deviceId,
  existing,
  onSaved,
  onCancel,
}: {
  /** Seeds the first condition row and the action target for a new rule.
   * Optional — the builder stands alone, each row picks its own device. */
  deviceId?: string;
  existing?: RuleResponse;
  onSaved: (saved: RuleResponse) => void;
  onCancel: () => void;
}) {
  if (existing && !isFlatCondition(existing.condition)) {
    return <NotFlatConditionNotice rule={existing} onCancel={onCancel} />;
  }
  return (
    <RuleFormInner deviceId={deviceId} existing={existing} onSaved={onSaved} onCancel={onCancel} />
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="md">
      <div className="flex flex-col gap-4">
        <h2 className={SECTION_LABEL}>{title}</h2>
        {children}
      </div>
    </Card>
  );
}

function RuleFormInner({
  deviceId,
  existing,
  onSaved,
  onCancel,
}: {
  deviceId?: string;
  existing?: RuleResponse;
  onSaved: (saved: RuleResponse) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: catalogEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");

  const deviceList = useMemo(() => devices ?? [], [devices]);
  const seedDevice = deviceId ?? "";

  const catalogForDevice = useMemo(() => {
    const catalogById = new Map((catalogEntries ?? []).map((c) => [c.id, c]));
    const deviceById = new Map(deviceList.map((d) => [d.id, d]));
    return (id: string): CatalogEntryResponse | undefined => {
      const dev = deviceById.get(id);
      return dev ? catalogById.get(dev.catalog_entry_id) : undefined;
    };
  }, [catalogEntries, deviceList]);

  const metricOptionsFor = (id: string): WireOption[] => {
    const opts = new Map<string, string>();
    for (const m of catalogForDevice(id)?.metrics ?? []) opts.set(wireId(m), m.name);
    return Array.from(opts, ([optId, label]) => ({ id: optId, label }));
  };
  const actuatorOptionsFor = (id: string): WireOption[] => {
    const opts = new Map<string, string>();
    for (const a of catalogForDevice(id)?.actuators ?? []) opts.set(wireId(a), a.name);
    return Array.from(opts, ([optId, label]) => ({ id: optId, label }));
  };

  const initial = useMemo(
    () =>
      existing
        ? draftsFromCondition(existing.condition, seedDevice)
        : { predicates: [emptyPredicate(seedDevice)], combinator: "AND" as Combinator },
    [existing, seedDevice],
  );

  const [name, setName] = useState(existing?.name ?? "");
  const [predicates, setPredicates] = useState<LeafDraft[]>(initial.predicates);
  const [combinator, setCombinator] = useState<Combinator>(initial.combinator);
  const [forDuration, setForDuration] = useState(existing?.for_duration ?? DEFAULT_FOR_DURATION);
  const [cooldown, setCooldown] = useState(existing?.cooldown ?? DEFAULT_COOLDOWN);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const existingTrigger = (existing?.trigger ?? {}) as Record<string, unknown>;
  const [triggerType, setTriggerType] = useState<TriggerType>(
    (existingTrigger.type as TriggerType) ?? "metric",
  );
  const [cron, setCron] = useState(
    typeof existingTrigger.cron === "string" ? existingTrigger.cron : "0 8 * * *",
  );
  const [timezone, setTimezone] = useState(
    typeof existingTrigger.timezone === "string" ? existingTrigger.timezone : "UTC",
  );
  const [deviceStatusDeviceId, setDeviceStatusDeviceId] = useState(
    typeof existingTrigger.device_id === "string" ? existingTrigger.device_id : seedDevice,
  );
  const [deviceStatusTransition, setDeviceStatusTransition] = useState<DeviceStatusTransition>(
    existingTrigger.transition === "disconnected" ? "disconnected" : "connected",
  );

  const existingAction = existing?.action as Record<string, unknown> | undefined;
  const [actionType, setActionType] = useState<ActionType>(
    (existingAction?.type as ActionType) ?? "actuator_command",
  );
  const [actionDeviceId, setActionDeviceId] = useState(
    typeof existingAction?.device_id === "string" ? existingAction.device_id : seedDevice,
  );
  const [actuator, setActuator] = useState(
    typeof existingAction?.actuator === "string" ? existingAction.actuator : "",
  );

  const actuatorOptions = actuatorOptionsFor(actionDeviceId);
  const selectedActuator = useMemo(
    () => (catalogForDevice(actionDeviceId)?.actuators ?? []).find((a) => wireId(a) === actuator),
    [catalogForDevice, actionDeviceId, actuator],
  );
  const catalogControlled = selectedActuator != null;
  const [valueKind, setValueKind] = useState<ValueKind>(
    typeof existingAction?.value === "number"
      ? "number"
      : typeof existingAction?.value === "string"
        ? "text"
        : "boolean",
  );
  const effectiveKind: ValueKind = catalogControlled
    ? TYPE_TO_KIND[selectedActuator.value_type]
    : valueKind;
  const showManualKind = actuator.trim() !== "" && !catalogControlled;
  const boolLabels = {
    off: String(selectedActuator?.off_value ?? "Off"),
    on: String(selectedActuator?.on_value ?? "On"),
  };

  const [boolValue, setBoolValue] = useState(existingAction?.value !== false);
  const [numValue, setNumValue] = useState(
    typeof existingAction?.value === "number" ? existingAction.value : 0,
  );
  const [textValue, setTextValue] = useState(
    typeof existingAction?.value === "string" ? existingAction.value : "",
  );
  const [message, setMessage] = useState(
    typeof existingAction?.message === "string" ? existingAction.message : "",
  );
  const [emailChannel, setEmailChannel] = useState(
    Array.isArray(existingAction?.channels) &&
      (existingAction.channels as string[]).includes("email"),
  );
  const [webhookUrl, setWebhookUrl] = useState(
    typeof existingAction?.url === "string" ? existingAction.url : "",
  );
  const [webhookBody, setWebhookBody] = useState(
    existingAction?.body ? JSON.stringify(existingAction.body, null, 2) : "{}",
  );

  // On-clear: the form represents one "command on clear" (same device +
  // actuator as the action) and one clear notification. Anything else in an
  // existing rule's clear_actions (API-authored) is passed through untouched.
  const existingClear = (existing?.clear_actions ?? []) as Record<string, unknown>[];
  const existingClearCommand = existingClear.find(
    (a) =>
      a.type === "actuator_command" &&
      a.actuator === existingAction?.actuator &&
      a.device_id === existingAction?.device_id,
  );
  const existingClearNotify = existingClear.find((a) => a.type === "notification");
  const preservedClear = existingClear.filter(
    (a) => a !== existingClearCommand && a !== existingClearNotify,
  );
  const [clearCommand, setClearCommand] = useState(existingClearCommand != null);
  // null = "the opposite of the action's on/off value", tracked live.
  const [clearBool, setClearBool] = useState<boolean | null>(
    typeof existingClearCommand?.value === "boolean" ? existingClearCommand.value : null,
  );
  const [clearNum, setClearNum] = useState(
    typeof existingClearCommand?.value === "number" ? existingClearCommand.value : 0,
  );
  const [clearText, setClearText] = useState(
    typeof existingClearCommand?.value === "string" ? existingClearCommand.value : "",
  );
  const [clearNotify, setClearNotify] = useState(existingClearNotify != null);
  const [clearMessage, setClearMessage] = useState(
    typeof existingClearNotify?.message === "string" ? existingClearNotify.message : "",
  );
  const [clearDelay, setClearDelay] = useState(
    existing?.execution_policy.clear_for_duration ?? 0,
  );

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addPredicate() {
    const last = predicates[predicates.length - 1];
    setPredicates([...predicates, emptyPredicate(last?.deviceId ?? seedDevice)]);
  }

  function buildAction(): Record<string, unknown> | null {
    if (actionType === "actuator_command") {
      if (!actuator.trim() || !actionDeviceId) return null;
      const value =
        effectiveKind === "boolean" ? boolValue : effectiveKind === "number" ? numValue : textValue;
      return {
        type: "actuator_command",
        device_id: actionDeviceId,
        actuator: actuator.trim(),
        value,
      };
    }
    if (actionType === "notification") {
      if (!message.trim()) return null;
      return {
        type: "notification",
        message: message.trim(),
        channels: emailChannel ? ["platform", "email"] : ["platform"],
      };
    }
    if (!webhookUrl.trim()) return null;
    let body: Record<string, unknown> = {};
    try {
      body = webhookBody.trim() ? JSON.parse(webhookBody) : {};
    } catch {
      return null;
    }
    return { type: "webhook", url: webhookUrl.trim(), body };
  }

  const canClearCommand = actionType === "actuator_command";
  const effectiveClearBool = clearBool ?? !boolValue;

  function buildClearActions(): Record<string, unknown>[] {
    if (triggerType !== "metric") return [];
    const out: Record<string, unknown>[] = [];
    if (clearCommand && canClearCommand && actuator.trim() && actionDeviceId) {
      out.push({
        type: "actuator_command",
        device_id: actionDeviceId,
        actuator: actuator.trim(),
        value:
          effectiveKind === "boolean"
            ? effectiveClearBool
            : effectiveKind === "number"
              ? clearNum
              : clearText,
      });
    }
    if (clearNotify && clearMessage.trim()) {
      out.push({ type: "notification", message: clearMessage.trim(), channels: ["platform"] });
    }
    return [...out, ...preservedClear];
  }

  function buildTrigger(): Record<string, unknown> {
    if (triggerType === "schedule")
      return { type: "schedule", cron: cron.trim(), timezone: timezone.trim() || "UTC" };
    if (triggerType === "manual") return { type: "manual" };
    if (triggerType === "device_status")
      return {
        type: "device_status",
        device_id: deviceStatusDeviceId,
        transition: deviceStatusTransition,
      };
    return { type: "metric" };
  }

  const action = buildAction();
  const previewAction = action ?? { type: "actuator_command" as const, actuator: "…", value: true };
  const previewCondition = buildCondition(
    predicates.map((p) => ({ ...p, metric: p.metric || "…" })),
    combinator,
  );
  const deviceNameById = useMemo(
    () => Object.fromEntries(deviceList.map((d) => [d.id, d.name])),
    [deviceList],
  );
  const clearActions = buildClearActions();
  const release = releasePoint(previewCondition);
  const clearCommandActive = clearActions.some((a) => a.type === "actuator_command");
  // A clear is never held back by cooldown, so an analog reading dithering at
  // a zero-hysteresis threshold would toggle the actuator on every reading.
  const flappingRisk =
    clearCommandActive &&
    clearDelay === 0 &&
    predicates.some((p) => HYSTERESIS_OPERATORS.has(p.operator) && !(p.hysteresis > 0));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (predicates.length === 0 && triggerType !== "device_status") {
      setError("Add at least one condition.");
      return;
    }
    if (predicates.some((p) => !p.metric.trim() || !p.deviceId)) {
      setError("Every condition needs a device and a metric.");
      return;
    }
    if (predicates.some((p) => p.rhsKind === "metric" && (!p.rhsDeviceId || !p.rhsMetric))) {
      setError("A device comparison needs both a device and a metric.");
      return;
    }
    if (triggerType === "schedule" && !cron.trim()) {
      setError("A scheduled rule needs a cron expression.");
      return;
    }
    if (triggerType === "device_status" && !deviceStatusDeviceId) {
      setError("A device-status trigger needs a device.");
      return;
    }
    const finalAction = buildAction();
    if (finalAction === null) {
      setError(
        actionType === "webhook"
          ? "Webhook needs a URL and a valid JSON body."
          : "This action needs its required fields filled in.",
      );
      return;
    }
    if (triggerType === "metric" && clearNotify && !clearMessage.trim()) {
      setError("The clear notification needs a message.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: name.trim() || undefined,
        trigger: buildTrigger(),
        condition: buildCondition(predicates, combinator),
        execution_policy: {
          strategy: "edge",
          for_duration: forDuration,
          cooldown,
          clear_for_duration: triggerType === "metric" ? clearDelay : 0,
        },
        actions: [finalAction],
        clear_actions: buildClearActions(),
        enabled,
      };
      const saved = existing
        ? await api.patch<RuleResponse>(`/rules/${existing.id}`, body)
        : await api.post<RuleResponse>(`/rules`, body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save this rule.");
    } finally {
      setSubmitting(false);
    }
  }

  const detectedHint = catalogControlled
    ? `Detected from “${selectedActuator.name}” — a ${VALUE_TYPE_WORD[selectedActuator.value_type]} actuator.`
    : undefined;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <SectionCard title="Name">
        <Field label="Rule name" hint="Left blank, a name is generated from the condition.">
          <Input
            compact
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Boiler overheat interlock"
          />
        </Field>
      </SectionCard>

      <SectionCard title="Trigger">
        <SegmentedControl
          ariaLabel="Trigger type"
          value={triggerType}
          onChange={setTriggerType}
          options={[
            { value: "metric", label: "On reading" },
            { value: "schedule", label: "Schedule" },
            { value: "manual", label: "Manual only" },
            { value: "device_status", label: "Device connects/disconnects" },
          ]}
        />
        {triggerType === "metric" && (
          <p className="text-sm text-ink-muted">
            Evaluated every time one of its metrics reports a new value.
          </p>
        )}
        {triggerType === "manual" && (
          <p className="text-sm text-ink-muted">
            Only runs when you press “Run now” on the rule — never automatically.
          </p>
        )}
        {triggerType === "device_status" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Device">
                <DeviceSelect
                  ariaLabel="Device status trigger device"
                  value={deviceStatusDeviceId}
                  devices={deviceList}
                  onChange={setDeviceStatusDeviceId}
                />
              </Field>
              <Field label="When it">
                <SegmentedControl
                  ariaLabel="Transition"
                  value={deviceStatusTransition}
                  onChange={setDeviceStatusTransition}
                  options={[
                    { value: "connected", label: "Connects" },
                    { value: "disconnected", label: "Disconnects" },
                  ]}
                />
              </Field>
            </div>
            <p className="text-sm text-ink-muted">
              No condition below is needed — this fires on every matching transition. Add one only
              to also gate on another signal (e.g. only alert if a backup sensor is also offline).
            </p>
          </div>
        )}
        {triggerType === "schedule" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cron" hint="Standard 5-field cron. The condition is still checked on each run.">
              <Input
                compact
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 8 * * *"
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <Button
                    key={p.cron}
                    type="button"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setCron(p.cron)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </Field>
            <Field label="Timezone" hint="IANA name, e.g. America/New_York.">
              <Input compact value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard title={triggerType === "device_status" ? "Condition (optional)" : "Condition"}>
        {predicates.map((predicate, i) => (
          <Fragment key={predicate.uid}>
            {i > 0 && (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                {i === 1 ? (
                  <SegmentedControl
                    ariaLabel="Combine conditions with"
                    value={combinator}
                    onChange={setCombinator}
                    options={[
                      { value: "AND", label: "AND" },
                      { value: "OR", label: "OR" },
                    ]}
                  />
                ) : (
                  <span className={SECTION_LABEL}>{combinator}</span>
                )}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <PredicateRow
              predicate={predicate}
              devices={deviceList}
              metricOptions={metricOptionsFor(predicate.deviceId)}
              rhsMetricOptions={metricOptionsFor(predicate.rhsDeviceId)}
              removable={triggerType === "device_status" ? predicates.length > 0 : predicates.length > 1}
              onChange={(next) => setPredicates(predicates.map((p, j) => (i === j ? next : p)))}
              onRemove={() => setPredicates(predicates.filter((_, j) => i !== j))}
            />
          </Fragment>
        ))}
        <Button type="button" variant="ghost" className="self-start" onClick={addPredicate}>
          <Plus size={14} aria-hidden />
          Add condition
        </Button>
      </SectionCard>

      <SectionCard title="Flapping protection">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberSafetyField
            label="Hold time (s)"
            hint="Ignore brief spikes — the condition must hold this long."
            value={forDuration}
            onChange={setForDuration}
            min={5}
          />
          <NumberSafetyField
            label="Minimum interval (s)"
            hint="Shortest time allowed between firings."
            value={cooldown}
            onChange={setCooldown}
            min={30}
          />
        </div>
      </SectionCard>

      <SectionCard title="Action">
        <SegmentedControl
          ariaLabel="Action type"
          value={actionType}
          onChange={setActionType}
          options={[
            { value: "actuator_command", label: "Device command" },
            { value: "notification", label: "Notification" },
            { value: "webhook", label: "Webhook" },
          ]}
        />

        {actionType === "actuator_command" && (
          <div className="flex flex-col gap-4">
            <div className={cn("grid grid-cols-1 gap-4", "sm:grid-cols-2")}>
              <Field label="Device">
                <DeviceSelect
                  ariaLabel="Action device"
                  value={actionDeviceId}
                  devices={deviceList}
                  onChange={(id) => {
                    setActionDeviceId(id);
                    setActuator("");
                  }}
                />
              </Field>
              <Field label="Actuator">
                {actuatorOptions.length > 0 ? (
                  <Select compact value={actuator} onChange={(e) => setActuator(e.target.value)}>
                    <option value="" disabled>
                      Choose an actuator…
                    </option>
                    {actuatorOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    compact
                    placeholder="actuator name"
                    value={actuator}
                    onChange={(e) => setActuator(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {showManualKind && (
              <Field
                label="Value kind"
                hint="This actuator isn't in the device template — pick how its value is sent."
              >
                <Select
                  compact
                  value={valueKind}
                  onChange={(e) => setValueKind(e.target.value as ValueKind)}
                >
                  <option value="boolean">On / Off</option>
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                </Select>
              </Field>
            )}

            <Field label="Value" hint={detectedHint}>
              {effectiveKind === "boolean" && (
                <SegmentedControl
                  ariaLabel="Value"
                  variant="solid"
                  value={boolValue ? "on" : "off"}
                  onChange={(v) => setBoolValue(v === "on")}
                  options={[
                    { value: "off", label: boolLabels.off },
                    { value: "on", label: boolLabels.on },
                  ]}
                />
              )}
              {effectiveKind === "number" && (
                <Input
                  compact
                  type="number"
                  step="any"
                  value={numValue}
                  onChange={(e) => setNumValue(Number(e.target.value))}
                />
              )}
              {effectiveKind === "text" && (
                <Input compact value={textValue} onChange={(e) => setTextValue(e.target.value)} />
              )}
            </Field>
          </div>
        )}

        {actionType === "notification" && (
          <div className="flex flex-col gap-4">
            <Field label="Message">
              <Textarea
                compact
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Channels">
              <div className="flex flex-col gap-1.5 text-sm text-ink">
                <label className="flex items-center gap-2 text-ink-muted">
                  <input type="checkbox" className="accent-accent" checked disabled />
                  In-app activity feed
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={emailChannel}
                    onChange={(e) => setEmailChannel(e.target.checked)}
                  />
                  Email the workspace alert recipients
                </label>
              </div>
            </Field>
          </div>
        )}

        {actionType === "webhook" && (
          <div className="flex flex-col gap-4">
            <Field label="URL">
              <Input
                compact
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/hook"
              />
            </Field>
            <Field label="Body (JSON)">
              <Textarea
                compact
                value={webhookBody}
                onChange={(e) => setWebhookBody(e.target.value)}
                rows={3}
                className="font-mono"
              />
            </Field>
          </div>
        )}
      </SectionCard>

      {triggerType === "metric" && (
        <SectionCard title="When the condition clears">
          <p className="text-sm text-ink-muted">
            {release ? (
              <>
                Clears when <strong>{release.metric}</strong> {release.words}{" "}
                <strong>{release.value}</strong>
                {predicates[0]?.hysteresis > 0 && " (the threshold minus its hysteresis)"}.
              </>
            ) : (
              "Clears once the whole condition is no longer true."
            )}{" "}
            Runs once per firing. If a reading goes stale nothing is sent — the last state holds.
          </p>

          <label
            className={cn(
              "flex items-center gap-2 text-sm",
              canClearCommand ? "text-ink" : "text-ink-muted",
            )}
          >
            <input
              type="checkbox"
              className="accent-accent"
              checked={clearCommand && canClearCommand}
              disabled={!canClearCommand}
              onChange={(e) => setClearCommand(e.target.checked)}
            />
            {canClearCommand
              ? `Send ${actuator.trim() || "the actuator"} a value when it clears`
              : "Send a device command when it clears (needs a device-command action)"}
          </label>
          {clearCommand && canClearCommand && (
            <Field
              label="Value on clear"
              hint={
                effectiveKind === "boolean" && clearBool === null
                  ? "Defaults to the opposite of the action's value."
                  : undefined
              }
            >
              {effectiveKind === "boolean" && (
                <SegmentedControl
                  ariaLabel="Value on clear"
                  variant="solid"
                  value={effectiveClearBool ? "on" : "off"}
                  onChange={(v) => setClearBool(v === "on")}
                  options={[
                    { value: "off", label: boolLabels.off },
                    { value: "on", label: boolLabels.on },
                  ]}
                />
              )}
              {effectiveKind === "number" && (
                <Input
                  compact
                  type="number"
                  step="any"
                  value={clearNum}
                  onChange={(e) => setClearNum(Number(e.target.value))}
                />
              )}
              {effectiveKind === "text" && (
                <Input compact value={clearText} onChange={(e) => setClearText(e.target.value)} />
              )}
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="accent-accent"
              checked={clearNotify}
              onChange={(e) => setClearNotify(e.target.checked)}
            />
            Send a notification when it clears
          </label>
          {clearNotify && (
            <Field label="Clear message">
              <Input
                compact
                value={clearMessage}
                onChange={(e) => setClearMessage(e.target.value)}
                placeholder="e.g. Temperature back to normal"
              />
            </Field>
          )}

          {(clearCommand || clearNotify) && (
            <div className="max-w-xs">
              <NumberSafetyField
                label="Clear delay (s)"
                hint="The condition must stay cleared this long first — e.g. keep a light on 10s after release."
                value={clearDelay}
                onChange={setClearDelay}
                min={0}
              />
            </div>
          )}

          {preservedClear.length > 0 && (
            <p className="text-sm text-ink-muted">
              Also keeps {preservedClear.length} clear action
              {preservedClear.length === 1 ? "" : "s"} set through the API.
            </p>
          )}

          {flappingRisk && (
            <Callout tone="warning">
              With no hysteresis and no clear delay, a reading hovering at the threshold switches{" "}
              {actuator.trim() || "the actuator"} on and off with every reading. Set a hysteresis on
              the condition (Advanced) or a clear delay.
            </Callout>
          )}
        </SectionCard>
      )}

      <Card padding="md">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </Card>

      <Card padding="md">
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Summary</span>
          <RuleSummary
            rule={{
              condition: previewCondition,
              for_duration: forDuration,
              action: previewAction,
              trigger: buildTrigger(),
              clear_actions: clearActions,
              clear_for_duration: clearDelay,
            }}
            placeholder="…"
            className="text-[15px] leading-relaxed"
            deviceNameById={deviceNameById}
          />
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="flex gap-3 border-t border-border pt-4">
        <Button type="submit" size="md" disabled={submitting}>
          {submitting ? "Saving…" : existing ? "Save changes" : "Create rule"}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
