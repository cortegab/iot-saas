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
import { RuleSummary, type ConditionLeaf, type ConditionNode } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type ActionType = "actuator_command" | "notification" | "webhook";
type ValueKind = "boolean" | "number" | "text";
type Combinator = "AND" | "OR";

interface LeafDraft {
  /** Stable client-only key so a per-row disclosure's state doesn't leak to
   * a neighbour when a row above it is removed. Never sent. */
  uid: string;
  deviceId: string;
  metric: string;
  operator: string;
  threshold: number;
  hysteresis: number;
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
];

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
    threshold: 0,
    hysteresis: DEFAULT_HYSTERESIS,
  };
}

function isFlatCondition(condition: ConditionNode): boolean {
  return condition.kind === "leaf" || condition.predicates.every((p) => p.kind === "leaf");
}

function leafDevice(leaf: ConditionLeaf, fallback: string): string {
  const raw = (leaf as { device_id?: string | null }).device_id;
  return typeof raw === "string" && raw ? raw : fallback;
}

function draftsFromCondition(
  condition: ConditionNode,
  fallbackDevice: string,
): { predicates: LeafDraft[]; combinator: Combinator } {
  const toDraft = (leaf: ConditionLeaf): LeafDraft => ({
    uid: newUid(),
    deviceId: leafDevice(leaf, fallbackDevice),
    metric: leaf.metric,
    operator: leaf.operator,
    threshold: leaf.threshold,
    hysteresis: leaf.hysteresis,
  });
  if (condition.kind === "leaf") return { predicates: [toDraft(condition)], combinator: "AND" };
  return {
    predicates: (condition.predicates as ConditionLeaf[]).map(toDraft),
    combinator: condition.op,
  };
}

function buildCondition(predicates: LeafDraft[], combinator: Combinator): ConditionNode {
  const leaves = predicates.map(
    (p) =>
      ({
        kind: "leaf",
        device_id: p.deviceId,
        metric: p.metric,
        operator: p.operator,
        threshold: p.threshold,
        hysteresis: p.hysteresis,
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

function PredicateRow({
  predicate,
  devices,
  metricOptions,
  onChange,
  onRemove,
  removable,
}: {
  predicate: LeafDraft;
  devices: DeviceResponse[];
  metricOptions: WireOption[];
  onChange: (next: LeafDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(predicate.hysteresis > 0);

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
        <Field label="Threshold">
          <Input
            compact
            type="number"
            step="any"
            value={predicate.threshold}
            onChange={(e) => onChange({ ...predicate, threshold: Number(e.target.value) })}
          />
        </Field>
        {removable && (
          <div className="flex items-end">
            <Button type="button" variant="destructive" onClick={onRemove}>
              Remove
            </Button>
          </div>
        )}
      </div>

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
              hint="How far this reading must fall back past the threshold before the rule can fire again."
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
  const [webhookUrl, setWebhookUrl] = useState(
    typeof existingAction?.url === "string" ? existingAction.url : "",
  );
  const [webhookBody, setWebhookBody] = useState(
    existingAction?.body ? JSON.stringify(existingAction.body, null, 2) : "{}",
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
      return { type: "notification", message: message.trim() };
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

  const action = buildAction();
  const previewAction = action ?? { type: "actuator_command" as const, actuator: "…", value: true };
  const previewCondition = buildCondition(
    predicates.map((p) => ({ ...p, metric: p.metric || "…" })),
    combinator,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (predicates.some((p) => !p.metric.trim() || !p.deviceId)) {
      setError("Every condition needs a device and a metric.");
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

    setSubmitting(true);
    try {
      const body = {
        name: name.trim() || undefined,
        condition: buildCondition(predicates, combinator),
        execution_policy: { strategy: "edge", for_duration: forDuration, cooldown },
        actions: [finalAction],
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

      <SectionCard title="Condition">
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
              removable={predicates.length > 1}
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
          <Field label="Message">
            <Textarea compact value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </Field>
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
            rule={{ condition: previewCondition, for_duration: forDuration, action: previewAction }}
            placeholder="…"
            className="text-[15px] leading-relaxed"
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
