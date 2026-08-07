"use client";

/**
 * Builds/edits a *flat* condition: N predicate rows combined by one top-level
 * AND/OR toggle — not a nested group builder (a deliberate v1 scope cut: the
 * backend's condition tree is fully recursive, but a nested group-editor UI
 * is a substantially bigger frontend task than the requirement needed). A
 * rule whose condition is a real nested tree (only reachable via direct API
 * use) falls back to a read-only view here — see NotFlatConditionNotice.
 */

import { useMemo, useState, type FormEvent } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ApiRequestError } from "@/lib/api-client";
import { RuleSummary, type ConditionLeaf, type ConditionNode } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
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

const OPERATORS: { value: string; label: string }[] = [
  { value: ">", label: "> above" },
  { value: ">=", label: "≥ at or above" },
  { value: "<", label: "< below" },
  { value: "<=", label: "≤ at or below" },
  { value: "==", label: "= equal to" },
  { value: "!=", label: "≠ different from" },
];

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

function SafetyField({
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
    <label className="flex flex-col gap-1 text-sm text-ink-muted">
      {label}
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
      />
      <span className="text-xs">{hint}</span>
      {value < min && (
        <span className="text-xs text-status-pending">
          Low values make relays cycle rapidly on noisy readings — consider {min} or higher.
        </span>
      )}
    </label>
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
  metricOptions: string[];
  onChange: (next: LeafDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Metric
        {metricOptions.length > 0 ? (
          <select
            value={predicate.metric}
            onChange={(e) => onChange({ ...predicate, metric: e.target.value })}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
          >
            <option value="" disabled>
              Choose a metric…
            </option>
            {metricOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-muted">
            No metrics declared
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Comparison
        <select
          value={predicate.operator}
          onChange={(e) => onChange({ ...predicate, operator: e.target.value })}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        >
          {OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Threshold
        <input
          type="number"
          step="any"
          value={predicate.threshold}
          onChange={(e) => onChange({ ...predicate, threshold: Number(e.target.value) })}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Re-arm gap
        <input
          type="number"
          min={0}
          step="any"
          value={predicate.hysteresis}
          onChange={(e) => onChange({ ...predicate, hysteresis: Number(e.target.value) })}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="self-end rounded-md px-2 py-2 text-sm text-status-error hover:bg-surface-raised"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** Shown instead of the form when an existing rule's condition is a real
 * nested tree — only reachable via direct API use, since this form never
 * builds one. Editing is blocked rather than risk silently flattening it. */
function NotFlatConditionNotice({ rule, onCancel }: { rule: RuleResponse; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <RuleSummary rule={rule} />
      <p className="text-sm text-status-pending">
        This rule has a nested condition structure that isn&apos;t editable here — it was created
        directly through the API. Delete and recreate it to use this form.
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="self-start rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-raised"
      >
        Close
      </button>
    </div>
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

  return (
    <RuleFormInner deviceId={deviceId} existing={existing} onSaved={onSaved} onCancel={onCancel} />
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
  const metricOptions = useMemo(() => {
    const declared = (catalogEntry?.metrics ?? []).map((m) => m.name);
    const names = new Set(declared.length > 0 ? declared : (latest ?? []).map((r) => r.metric));
    for (const p of predicates) if (p.metric) names.add(p.metric);
    return Array.from(names);
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
  const [valueKind, setValueKind] = useState<ValueKind>(
    typeof existingAction?.value === "number"
      ? "number"
      : typeof existingAction?.value === "string"
        ? "text"
        : "boolean",
  );
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

  function buildAction(): Record<string, unknown> | null {
    if (actionType === "actuator_command") {
      if (!actuator.trim()) return null;
      const value = valueKind === "boolean" ? boolValue : valueKind === "number" ? numValue : textValue;
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

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4"
    >
      <RuleSummary rule={{ condition: previewCondition, for_duration: forDuration, action: previewAction }} />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">Condition</legend>
        {predicates.map((predicate, i) => (
          <PredicateRow
            key={i}
            predicate={predicate}
            metricOptions={metricOptions}
            removable={predicates.length > 1}
            onChange={(next) => setPredicates(predicates.map((p, j) => (i === j ? next : p)))}
            onRemove={() => setPredicates(predicates.filter((_, j) => i !== j))}
          />
        ))}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setPredicates([
                ...predicates,
                { metric: "", operator: ">", threshold: 0, hysteresis: DEFAULT_HYSTERESIS },
              ])
            }
            className="text-sm text-accent"
          >
            + Add condition
          </button>
          {predicates.length > 1 && (
            <div className="flex gap-1" role="group" aria-label="Combine conditions with">
              {(["AND", "OR"] as Combinator[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={combinator === c}
                  onClick={() => setCombinator(c)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    combinator === c
                      ? "bg-surface-raised text-ink font-medium"
                      : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {/* Safety fields — protect real hardware from flapping on noisy
          readings (UX_UI_Description.md §6). Never bypassable: the backend
          re-validates ge=0 regardless of what this form allows. Hysteresis
          lives per-predicate above now, not here — it only makes sense
          against one scalar comparison. */}
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="col-span-full text-xs font-medium uppercase tracking-wide text-ink-muted">
          Flapping protection
        </legend>
        <SafetyField
          label="Hold time (s)"
          hint="Ignore brief spikes — the condition must hold this long."
          value={forDuration}
          onChange={setForDuration}
          min={5}
        />
        <SafetyField
          label="Minimum interval (s)"
          hint="Shortest time allowed between firings."
          value={cooldown}
          onChange={setCooldown}
          min={30}
        />
      </fieldset>

      {/* Action — one editor per type; every type must read naturally in the
          summary above (UX_UI_Description.md §6: "Cover every action type"). */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">Action</legend>
        <div className="flex gap-1" role="group" aria-label="Action type">
          {(["actuator_command", "notification", "webhook"] as ActionType[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={actionType === t}
              onClick={() => setActionType(t)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                actionType === t
                  ? "bg-surface-raised text-ink font-medium"
                  : "text-ink-muted hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {t === "actuator_command" ? "Device command" : t === "notification" ? "Notification" : "Webhook"}
            </button>
          ))}
        </div>

        {actionType === "actuator_command" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Actuator
              <input
                value={actuator}
                onChange={(e) => setActuator(e.target.value)}
                placeholder="e.g. fan1"
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Value type
              <select
                value={valueKind}
                onChange={(e) => setValueKind(e.target.value as ValueKind)}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
              >
                <option value="boolean">On / Off</option>
                <option value="number">Number</option>
                <option value="text">Text</option>
              </select>
            </label>
            {valueKind === "boolean" && (
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Value
                <select
                  value={boolValue ? "true" : "false"}
                  onChange={(e) => setBoolValue(e.target.value === "true")}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
                >
                  <option value="true">ON</option>
                  <option value="false">OFF</option>
                </select>
              </label>
            )}
            {valueKind === "number" && (
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Value
                <input
                  type="number"
                  step="any"
                  value={numValue}
                  onChange={(e) => setNumValue(Number(e.target.value))}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
                />
              </label>
            )}
            {valueKind === "text" && (
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Value
                <input
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
                />
              </label>
            )}
          </div>
        )}

        {actionType === "notification" && (
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
            />
          </label>
        )}

        {actionType === "webhook" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              URL
              <input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/hook"
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Body (JSON)
              <textarea
                value={webhookBody}
                onChange={(e) => setWebhookBody(e.target.value)}
                rows={3}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-ink"
              />
            </label>
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Saving…" : existing ? "Save changes" : "Create rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-raised"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
