"use client";

/**
 * Builds/edits a *flat* condition: N predicate rows combined by one top-level
 * AND/OR toggle — not a nested group builder (a deliberate v1 scope cut: the
 * backend's condition tree is fully recursive, but a nested group-editor UI
 * is a substantially bigger frontend task than the requirement needed). A
 * rule whose condition is a real nested tree (only reachable via direct API
 * use) falls back to a read-only view here — see NotFlatConditionNotice.
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
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type ActionType = "actuator_command" | "notification" | "webhook";
type ValueKind = "boolean" | "number" | "text";
type Combinator = "AND" | "OR";

interface LeafDraft {
  metric: string;
  operator: string;
  threshold: number;
  hysteresis: number;
}

/** A selectable metric/actuator: `id` is the stable wire identifier stored
 * on the rule (catalog `key`, falling back to a slugified `name` for legacy
 * entries), `label` is the pretty catalog `name` shown in the dropdown. */
interface WireOption {
  id: string;
  label: string;
}

function addOption(options: Map<string, string>, id: string, label: string): void {
  if (!options.has(id)) options.set(id, label);
}

// Backend `_OPERATOR_PATTERN` is `^(>|>=|<|<=|==|!=)$` — no "crosses above/below"
// edge-trigger operators, so the prototype's extra comparisons aren't offered.
const OPERATORS: { value: string; label: string }[] = [
  { value: ">", label: "> above" },
  { value: ">=", label: "≥ at or above" },
  { value: "<", label: "< below" },
  { value: "<=", label: "≤ at or below" },
  { value: "==", label: "= equal to" },
  { value: "!=", label: "≠ different from" },
];

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-ink-muted";

// CatalogActuator.value_type → the value control shown for it.
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

// Safe, non-zero starting points (UX_UI_Description.md §6: "their defaults
// must be safe rather than zero. This is a hardware-safety requirement, not
// a preference") — a user can still weaken them, but never by one click.
const DEFAULT_FOR_DURATION = 10;
const DEFAULT_HYSTERESIS = 1;
const DEFAULT_COOLDOWN = 60;

function isFlatCondition(condition: ConditionNode): boolean {
  return condition.kind === "leaf" || condition.predicates.every((p) => p.kind === "leaf");
}

function draftsFromCondition(condition: ConditionNode): { predicates: LeafDraft[]; combinator: Combinator } {
  if (condition.kind === "leaf") {
    return {
      predicates: [
        {
          metric: condition.metric,
          operator: condition.operator,
          threshold: condition.threshold,
          hysteresis: condition.hysteresis,
        },
      ],
      combinator: "AND",
    };
  }
  return {
    predicates: (condition.predicates as ConditionLeaf[]).map((leaf) => ({
      metric: leaf.metric,
      operator: leaf.operator,
      threshold: leaf.threshold,
      hysteresis: leaf.hysteresis,
    })),
    combinator: condition.op,
  };
}

function buildCondition(predicates: LeafDraft[], combinator: Combinator): ConditionNode {
  const leaves: ConditionLeaf[] = predicates.map((p) => ({
    kind: "leaf",
    metric: p.metric,
    operator: p.operator,
    threshold: p.threshold,
    hysteresis: p.hysteresis,
  }));
  if (leaves.length === 1) return leaves[0];
  return { kind: "group", op: combinator, predicates: leaves };
}

/** A hardware-safety number field: the amber note when the value dips below a
 * recommended minimum is advisory — the backend re-validates `ge=0` and this
 * never blocks submit. */
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

function PredicateRow({
  predicate,
  metricOptions,
  onChange,
  onRemove,
  removable,
}: {
  predicate: LeafDraft;
  metricOptions: WireOption[];
  onChange: (next: LeafDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.6fr_1.3fr_1fr_1fr_auto]">
      <Field label="Metric">
        {metricOptions.length > 0 ? (
          <Select compact value={predicate.metric} onChange={(e) => onChange({ ...predicate, metric: e.target.value })}>
            <option value="" disabled>
              Choose a metric…
            </option>
            {metricOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-ink-muted">
            No metrics declared
          </span>
        )}
      </Field>
      <Field label="Comparison">
        <Select compact value={predicate.operator} onChange={(e) => onChange({ ...predicate, operator: e.target.value })}>
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
      <Field
        label="Hysteresis"
        hint="How far the reading must fall back past the threshold before the rule can fire again."
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
      {removable && (
        <div className="flex items-end">
          <Button type="button" variant="destructive" onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shown instead of the form when an existing rule's condition is a real
 * nested tree — only reachable via direct API use, since this form never
 * builds one. Editing is blocked rather than risk silently flattening it. */
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
  deviceId: string;
  existing?: RuleResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  if (existing && !isFlatCondition(existing.condition)) {
    return <NotFlatConditionNotice rule={existing} onCancel={onCancel} />;
  }

  return <RuleFormInner deviceId={deviceId} existing={existing} onSaved={onSaved} onCancel={onCancel} />;
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
  deviceId: string;
  existing?: RuleResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const { data: device } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: catalogEntry } = useApiSWR<CatalogEntryResponse>(
    device ? `/catalog/${device.catalog_entry_id}` : null,
  );
  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);

  const initial = useMemo(
    () => (existing ? draftsFromCondition(existing.condition) : { predicates: [], combinator: "AND" as Combinator }),
    [existing],
  );
  const [predicates, setPredicates] = useState<LeafDraft[]>(
    initial.predicates.length > 0
      ? initial.predicates
      : [{ metric: "", operator: ">", threshold: 0, hysteresis: DEFAULT_HYSTERESIS }],
  );
  const [combinator, setCombinator] = useState<Combinator>(initial.combinator);

  // Catalog-declared metrics are the primary source (the original
  // requirement: "each predicate references one metric of the catalog
  // entry") — falls back to currently-reported telemetry for a device on
  // the "Legacy" entry (no declared metrics), so undeclared devices aren't
  // left with an empty picker. Existing predicates' metrics are always
  // included so editing never silently drops a saved value from the list.
  // The saved/stored value is the wire id (catalog `key`, or a slugified
  // `name` for legacy entries) — the dropdown still shows the pretty `name`.
  const metricOptions = useMemo(() => {
    const declared = catalogEntry?.metrics ?? [];
    const options = new Map<string, string>();
    if (declared.length > 0) {
      for (const m of declared) addOption(options, wireId(m), m.name);
    } else {
      for (const r of latest ?? []) addOption(options, r.metric, r.metric);
    }
    for (const p of predicates) if (p.metric) addOption(options, p.metric, p.metric);
    return Array.from(options, ([id, label]) => ({ id, label }));
  }, [catalogEntry, latest, predicates]);

  const [forDuration, setForDuration] = useState(existing?.for_duration ?? DEFAULT_FOR_DURATION);
  const [cooldown, setCooldown] = useState(existing?.cooldown ?? DEFAULT_COOLDOWN);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const existingAction = existing?.action as Record<string, unknown> | undefined;
  const [actionType, setActionType] = useState<ActionType>(
    (existingAction?.type as ActionType) ?? "actuator_command",
  );
  const [actuator, setActuator] = useState(
    typeof existingAction?.actuator === "string" ? existingAction.actuator : "",
  );

  // Same reasoning as metricOptions: the template's declared actuators are
  // the primary source, plus the current value so editing never silently
  // drops a saved actuator that's no longer declared.
  const actuatorOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const a of catalogEntry?.actuators ?? []) addOption(options, wireId(a), a.name);
    if (actuator) addOption(options, actuator, actuator);
    return Array.from(options, ([id, label]) => ({ id, label }));
  }, [catalogEntry, actuator]);

  // The value control is driven by the chosen actuator's declared type. A
  // manual "value kind" picker only surfaces for an actuator that isn't in
  // the device's catalog (an old rule referencing a since-removed actuator).
  const selectedActuator = useMemo(
    () => (catalogEntry?.actuators ?? []).find((a) => wireId(a) === actuator),
    [catalogEntry, actuator],
  );
  const catalogControlled = selectedActuator != null;
  const [valueKind, setValueKind] = useState<ValueKind>(
    typeof existingAction?.value === "number"
      ? "number"
      : typeof existingAction?.value === "string"
        ? "text"
        : "boolean",
  );
  const effectiveKind: ValueKind = catalogControlled ? TYPE_TO_KIND[selectedActuator.value_type] : valueKind;
  const showManualKind = catalogEntry !== undefined && actuator.trim() !== "" && !catalogControlled;
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
    setPredicates([
      ...predicates,
      { metric: "", operator: ">", threshold: 0, hysteresis: DEFAULT_HYSTERESIS },
    ]);
  }

  function buildAction(): Record<string, unknown> | null {
    if (actionType === "actuator_command") {
      if (!actuator.trim()) return null;
      // Stored value stays a JS boolean for a bool actuator — on_value/off_value
      // are display labels only (same as commands/ActuatorControl).
      const value = effectiveKind === "boolean" ? boolValue : effectiveKind === "number" ? numValue : textValue;
      return { type: "actuator_command", actuator: actuator.trim(), value };
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
    if (predicates.some((p) => !p.metric.trim())) {
      setError("Every condition needs a metric.");
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
        condition: buildCondition(predicates, combinator),
        for_duration: forDuration,
        cooldown,
        action: finalAction,
        enabled,
      };
      if (existing) {
        await api.patch(`/rules/${existing.id}`, body);
      } else {
        await api.post(`/devices/${deviceId}/rules`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save this rule.");
    } finally {
      setSubmitting(false);
    }
  }

  const detectedHint = catalogControlled
    ? `Detected from “${selectedActuator.name}” — a ${VALUE_TYPE_WORD[selectedActuator.value_type]} actuator, so ${
        effectiveKind === "boolean" ? "the value is a simple choice" : "the value is typed directly"
      }.`
    : undefined;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <Card padding="md">
        <RuleSummary
          rule={{ condition: previewCondition, for_duration: forDuration, action: previewAction }}
          placeholder="…"
          className="text-[15px] leading-relaxed"
        />
      </Card>

      <SectionCard title="Condition">
        {predicates.map((predicate, i) => (
          <Fragment key={i}>
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
              metricOptions={metricOptions}
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

      {/* Safety fields — protect real hardware from flapping on noisy
          readings (UX_UI_Description.md §6). Never bypassable: the backend
          re-validates ge=0 regardless of what this form allows. */}
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

      {/* Action — one editor per type; every type must read naturally in the
          summary above (UX_UI_Description.md §6: "Cover every action type"). */}
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
            <div className={cn("grid grid-cols-1 gap-4", showManualKind && "sm:grid-cols-2")}>
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
                  <span className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-ink-muted">
                    No actuators declared
                  </span>
                )}
              </Field>
              {showManualKind && (
                <Field
                  label="Value kind"
                  hint="This actuator isn't in the device template — pick how its value is sent."
                >
                  <Select compact value={valueKind} onChange={(e) => setValueKind(e.target.value as ValueKind)}>
                    <option value="boolean">On / Off</option>
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                  </Select>
                </Field>
              )}
            </div>

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
