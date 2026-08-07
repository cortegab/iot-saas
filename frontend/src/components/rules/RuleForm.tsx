"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ApiRequestError } from "@/lib/api-client";
import { RuleSummary } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleCreateRequest = components["schemas"]["RuleCreateRequest"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];
type ActionType = "actuator_command" | "notification" | "webhook";
type ValueKind = "boolean" | "number" | "text";

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
  const api = useApi();
  const { data: latest } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`);
  const [metric, setMetric] = useState(existing?.metric ?? "");

  // The device's currently-reported metrics, plus whatever this rule already
  // watches (even if that metric has stopped reporting since) so editing an
  // existing rule never silently drops its saved value from the list.
  const metricOptions = useMemo(() => {
    const names = new Set((latest ?? []).map((r) => r.metric));
    if (existing?.metric) names.add(existing.metric);
    return Array.from(names);
  }, [latest, existing?.metric]);
  const [operator, setOperator] = useState(existing?.operator ?? ">");
  const [threshold, setThreshold] = useState(existing?.threshold ?? 0);
  const [forDuration, setForDuration] = useState(existing?.for_duration ?? DEFAULT_FOR_DURATION);
  const [hysteresis, setHysteresis] = useState(existing?.hysteresis ?? DEFAULT_HYSTERESIS);
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

  function buildAction(): RuleCreateRequest["action"] | null {
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!metric.trim()) {
      setError("Metric is required.");
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
        metric: metric.trim(),
        operator,
        threshold,
        for_duration: forDuration,
        hysteresis,
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
      <RuleSummary
        rule={{ metric: metric || "…", operator, threshold, for_duration: forDuration, action: previewAction }}
      />

      {/* Condition — kept as its own section so a future non-threshold rule
          type (UX_UI_Description.md §6) can replace just this block. */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">Condition</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Metric
            {metricOptions.length > 0 ? (
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
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
                No metrics reported yet
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Comparison
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
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
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
            />
          </label>
        </div>
      </fieldset>

      {/* Safety fields — protect real hardware from flapping on noisy
          readings (UX_UI_Description.md §6). Never bypassable: the backend
          re-validates ge=0 regardless of what this form allows. */}
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          label="Re-arm gap"
          hint="How far the value must fall back before this can fire again."
          value={hysteresis}
          onChange={setHysteresis}
          min={0.5}
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
