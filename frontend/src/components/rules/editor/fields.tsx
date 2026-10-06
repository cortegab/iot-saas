"use client";

/**
 * Field groups shared by both rule editors — form mode renders them in
 * section cards, ladder mode renders the selected element's group in its
 * inspector. Each takes a slice of the RuleDraft and reports a new slice.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { SchedulePicker } from "@/components/ui/SchedulePicker";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  ACTION_LABELS,
  HYSTERESIS_OPERATORS,
  OPERATORS,
  OPERATOR_ARITY,
  TRIGGER_LABELS,
  type ActionDraft,
  type ActuatorActionDraft,
  type ContactDraft,
  type TriggerType,
  type ValueKind,
  type WhenDraft,
} from "@/lib/rule-draft";
import type { CatalogActuator, RuleCatalog, WireOption } from "./useRuleCatalog";

export const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-ink-muted";

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

/** True while creating a rule: sections show their step numbers
 * (DESIGN.md §9.2: 1 When · 2 Then · 3 Safety · 4 Name). */
export const StepsContext = createContext(false);

export function SectionCard({
  title,
  aside,
  step,
  children,
}: {
  title: string;
  aside?: ReactNode;
  /** Shown only while creating (StepsContext). */
  step?: number;
  children: ReactNode;
}) {
  const numbered = useContext(StepsContext) && step != null;
  return (
    <Card padding="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className={cn(SECTION_LABEL, "flex items-center gap-2")}>
            {numbered && (
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold normal-case tracking-normal text-on-accent">
                {step}
              </span>
            )}
            {numbered ? <span className="sr-only">Step {step}: </span> : null}
            {title}
          </h2>
          {aside}
        </div>
        {children}
      </div>
    </Card>
  );
}

export function NumberSafetyField({
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

export function DeviceSelect({
  value,
  catalog,
  onChange,
  ariaLabel,
}: {
  value: string;
  catalog: RuleCatalog;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select compact aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a device…
      </option>
      {catalog.devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

function WireControl({
  value,
  options,
  onChange,
  noun,
  ariaLabel,
}: {
  value: string;
  options: WireOption[];
  onChange: (v: string) => void;
  noun: string;
  ariaLabel: string;
}) {
  if (options.length === 0) {
    return (
      <Input
        compact
        aria-label={ariaLabel}
        placeholder={`${noun} name`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Select compact aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose a{/^[aeiou]/.test(noun) ? "n" : ""} {noun}…
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

// ---- WHEN -------------------------------------------------------------------

const TRIGGER_HELP: Record<TriggerType, string> = {
  metric: "Checked every time one of the condition's metrics reports a new value.",
  schedule: "Runs at the scheduled times. With a condition, only if it's true at that moment.",
  manual: "Only runs when someone presses “Run now” on the rule — never automatically.",
  device_status:
    "Runs every time the device connects or disconnects. With a condition, only if it's also true.",
};

export function WhenFields({
  when,
  catalog,
  onChange,
}: {
  when: WhenDraft;
  catalog: RuleCatalog;
  onChange: (next: WhenDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        ariaLabel="Trigger"
        className="flex-wrap"
        value={when.type}
        onChange={(type) => onChange({ ...when, type })}
        options={(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => ({
          value: t,
          label: TRIGGER_LABELS[t],
        }))}
      />
      <p className="text-sm text-ink-muted">{TRIGGER_HELP[when.type]}</p>
      {when.type === "device_status" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Device">
            <DeviceSelect
              ariaLabel="Watched device"
              value={when.statusDeviceId}
              catalog={catalog}
              onChange={(statusDeviceId) => onChange({ ...when, statusDeviceId })}
            />
          </Field>
          <Field label="When it">
            <SegmentedControl
              ariaLabel="Transition"
              value={when.transition}
              onChange={(transition) => onChange({ ...when, transition })}
              options={[
                { value: "connected", label: "Connects" },
                { value: "disconnected", label: "Disconnects" },
              ]}
            />
          </Field>
        </div>
      )}
      {when.type === "schedule" && (
        // DESIGN.md §9.5: never ask for cron by default; cron stays the
        // stored value and an unusual one opens in Custom.
        <SchedulePicker cron={when.cron} timezone={when.timezone} onChange={({ cron, timezone }) => onChange({ ...when, cron, timezone })} />
      )}
    </div>
  );
}

// ---- IF: one contact ------------------------------------------------------------

function RhsValueControl({
  contact,
  onChange,
}: {
  contact: ContactDraft;
  onChange: (patch: Partial<ContactDraft>) => void;
}) {
  const arity = OPERATOR_ARITY[contact.operator] ?? "one";
  if (arity === "none") return <span className="flex h-9 items-center text-sm text-ink-muted">—</span>;
  if (arity === "range") {
    return (
      <span className="flex items-center gap-1.5">
        <Input
          compact
          type="number"
          step="any"
          aria-label="Low"
          value={contact.low}
          onChange={(e) => onChange({ low: Number(e.target.value) })}
        />
        <span className="text-xs text-ink-muted">–</span>
        <Input
          compact
          type="number"
          step="any"
          aria-label="High"
          value={contact.high}
          onChange={(e) => onChange({ high: Number(e.target.value) })}
        />
      </span>
    );
  }
  if (arity === "set") {
    return (
      <Input
        compact
        placeholder="e.g. 1, 2, 3"
        value={contact.setText}
        onChange={(e) => onChange({ setText: e.target.value })}
      />
    );
  }
  if (contact.rhsKind === "metric") return <span className="flex h-9 items-center text-sm text-ink-muted">see below</span>;
  return (
    <Input
      compact
      type="number"
      step="any"
      aria-label="Threshold"
      value={contact.value}
      onChange={(e) => onChange({ value: Number(e.target.value) })}
    />
  );
}

/** An on/off metric compared with "== 1" / "== 0" — shown as a plain
 * Is ON / Is OFF choice (a normally-open / normally-closed contact). */
export function isBoolContact(contact: ContactDraft, catalog: RuleCatalog): boolean {
  return (
    catalog.metricFor(contact.deviceId, contact.metric)?.data_type === "bool" &&
    contact.operator === "==" &&
    contact.rhsKind === "static" &&
    (contact.value === 0 || contact.value === 1)
  );
}

export function ContactFields({
  contact,
  catalog,
  onChange,
}: {
  contact: ContactDraft;
  catalog: RuleCatalog;
  onChange: (patch: Partial<ContactDraft>) => void;
}) {
  const arity = OPERATOR_ARITY[contact.operator] ?? "one";
  const boolMode = isBoolContact(contact, catalog);

  function pickMetric(metric: string) {
    // A freshly picked on/off metric starts as "is ON" — the common case.
    if (catalog.metricFor(contact.deviceId, metric)?.data_type === "bool") {
      onChange({ metric, operator: "==", rhsKind: "static", value: 1, hysteresis: 0 });
    } else {
      onChange({ metric });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.4fr_1.2fr_1fr]">
        <Field label="Device">
          <DeviceSelect
            ariaLabel="Condition device"
            value={contact.deviceId}
            catalog={catalog}
            onChange={(deviceId) => onChange({ deviceId, metric: "" })}
          />
        </Field>
        <Field label="Metric">
          <WireControl
            ariaLabel="Condition metric"
            noun="metric"
            value={contact.metric}
            options={catalog.metricOptionsFor(contact.deviceId)}
            onChange={pickMetric}
          />
        </Field>
        {boolMode ? (
          <Field label="Is" className="lg:col-span-2">
            <SegmentedControl
              ariaLabel="Contact state"
              variant="solid"
              value={contact.value === 1 ? "on" : "off"}
              onChange={(v) => onChange({ value: v === "on" ? 1 : 0 })}
              options={[
                { value: "on", label: "ON (normally open)" },
                { value: "off", label: "OFF (normally closed)" },
              ]}
            />
          </Field>
        ) : (
          <>
            <Field label="Comparison">
              <Select
                compact
                aria-label="Comparison"
                value={contact.operator}
                onChange={(e) => onChange({ operator: e.target.value })}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Value">
              <RhsValueControl contact={contact} onChange={onChange} />
            </Field>
          </>
        )}
      </div>

      {!boolMode && arity === "one" && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="link"
            className="self-start text-xs"
            onClick={() => onChange({ rhsKind: contact.rhsKind === "metric" ? "static" : "metric" })}
          >
            {contact.rhsKind === "metric"
              ? "Compare to a fixed value instead"
              : "Compare to another device instead"}
          </Button>
          {contact.rhsKind === "metric" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Other device">
                <DeviceSelect
                  ariaLabel="Comparison device"
                  value={contact.rhsDeviceId}
                  catalog={catalog}
                  onChange={(rhsDeviceId) => onChange({ rhsDeviceId, rhsMetric: "" })}
                />
              </Field>
              <Field label="Its metric">
                <WireControl
                  ariaLabel="Comparison metric"
                  noun="metric"
                  value={contact.rhsMetric}
                  options={catalog.metricOptionsFor(contact.rhsDeviceId)}
                  onChange={(rhsMetric) => onChange({ rhsMetric })}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {HYSTERESIS_OPERATORS.has(contact.operator) && (
        <div className="max-w-xs">
          <Field
            label="Hysteresis"
            hint="How far the reading must come back past the threshold before this counts as cleared — stops a relay chattering on a noisy reading."
          >
            <Input
              compact
              type="number"
              min={0}
              step="any"
              value={contact.hysteresis}
              onChange={(e) => onChange({ hysteresis: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// ---- THEN: one action -----------------------------------------------------------

function ActuatorValue({
  kind,
  bool,
  num,
  text,
  labels,
  ariaLabel,
  onChange,
}: {
  kind: ValueKind;
  bool: boolean;
  num: number;
  text: string;
  labels: { on: string; off: string };
  ariaLabel: string;
  onChange: (patch: { bool?: boolean; num?: number; text?: string }) => void;
}) {
  if (kind === "boolean") {
    return (
      <SegmentedControl
        ariaLabel={ariaLabel}
        variant="solid"
        value={bool ? "on" : "off"}
        onChange={(v) => onChange({ bool: v === "on" })}
        options={[
          { value: "off", label: labels.off },
          { value: "on", label: labels.on },
        ]}
      />
    );
  }
  if (kind === "number") {
    return (
      <Input
        compact
        type="number"
        step="any"
        aria-label={ariaLabel}
        value={num}
        onChange={(e) => onChange({ num: Number(e.target.value) })}
      />
    );
  }
  return (
    <Input compact aria-label={ariaLabel} value={text} onChange={(e) => onChange({ text: e.target.value })} />
  );
}

function ActuatorFields({
  action,
  catalog,
  clearing,
  onChange,
}: {
  action: ActuatorActionDraft;
  catalog: RuleCatalog;
  clearing: boolean;
  onChange: (next: ActuatorActionDraft) => void;
}) {
  const selected = catalog.actuatorFor(action.deviceId, action.actuator);
  const catalogKind = selected ? TYPE_TO_KIND[selected.value_type] : null;
  const kind = catalogKind ?? action.valueKind;
  const labels = {
    off: String(selected?.off_value ?? "Off"),
    on: String(selected?.on_value ?? "On"),
  };
  const patch = (p: Partial<ActuatorActionDraft>) => onChange({ ...action, ...p });

  function pickActuator(actuator: string) {
    const found = catalog.actuatorFor(action.deviceId, actuator);
    patch({ actuator, ...(found ? { valueKind: TYPE_TO_KIND[found.value_type] } : {}) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Device">
          <DeviceSelect
            ariaLabel="Actuator device"
            value={action.deviceId}
            catalog={catalog}
            onChange={(deviceId) => patch({ deviceId, actuator: "" })}
          />
        </Field>
        <Field label="Actuator">
          <WireControl
            ariaLabel="Actuator"
            noun="actuator"
            value={action.actuator}
            options={catalog.actuatorOptionsFor(action.deviceId)}
            onChange={pickActuator}
          />
        </Field>
      </div>
      {action.actuator.trim() !== "" && !selected && (
        <Field label="Value kind" hint="This actuator isn't in the device template — pick how its value is sent.">
          <Select
            compact
            value={action.valueKind}
            onChange={(e) => patch({ valueKind: e.target.value as ValueKind })}
          >
            <option value="boolean">On / Off</option>
            <option value="number">Number</option>
            <option value="text">Text</option>
          </Select>
        </Field>
      )}
      <Field
        label="Set it to"
        hint={
          selected
            ? `Detected from “${selected.name}” — a ${VALUE_TYPE_WORD[selected.value_type]} actuator.`
            : undefined
        }
      >
        <ActuatorValue
          ariaLabel="Actuator value"
          kind={kind}
          bool={action.bool}
          num={action.num}
          text={action.text}
          labels={labels}
          onChange={patch}
        />
      </Field>

      {clearing && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="accent-accent"
              checked={action.revertOnClear}
              onChange={(e) => patch({ revertOnClear: e.target.checked })}
            />
            Turn it back when the condition clears
          </label>
          {action.revertOnClear && (
            <Field
              label="Back to"
              hint={kind === "boolean" && action.clearBool === null ? "The opposite of the value above." : undefined}
            >
              <ActuatorValue
                ariaLabel="Value on clear"
                kind={kind}
                bool={action.clearBool ?? !action.bool}
                num={action.clearNum}
                text={action.clearText}
                labels={labels}
                onChange={(p) =>
                  patch({
                    ...(p.bool !== undefined ? { clearBool: p.bool } : {}),
                    ...(p.num !== undefined ? { clearNum: p.num } : {}),
                    ...(p.text !== undefined ? { clearText: p.text } : {}),
                  })
                }
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function ActionFields({
  action,
  catalog,
  clearing,
  onChange,
}: {
  action: ActionDraft;
  catalog: RuleCatalog;
  /** Whether "turn back when it clears" applies (reading rule, re-arm). */
  clearing: boolean;
  onChange: (next: ActionDraft) => void;
}) {
  if (action.kind === "actuator") {
    return <ActuatorFields action={action} catalog={catalog} clearing={clearing} onChange={onChange} />;
  }
  if (action.kind === "email") {
    return (
      <div className="flex flex-col gap-4">
        <Field label="To" hint="Comma-separated. Leave empty to email the workspace alert recipients (Settings → Alerts).">
          <Input
            compact
            value={action.to}
            onChange={(e) => onChange({ ...action, to: e.target.value })}
            placeholder="ops@example.com, oncall@example.com"
          />
        </Field>
        <Field label="Subject">
          <Input compact value={action.subject} onChange={(e) => onChange({ ...action, subject: e.target.value })} />
        </Field>
        <Field label="Message">
          <Textarea compact rows={3} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} />
        </Field>
      </div>
    );
  }
  if (action.kind === "webhook") {
    return (
      <div className="flex flex-col gap-4">
        <Field label="URL">
          <Input
            compact
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://example.com/hook"
          />
        </Field>
        <Field label="Body (JSON)">
          <Textarea
            compact
            rows={3}
            className="font-mono"
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
          />
        </Field>
      </div>
    );
  }
  return (
    <Field label="Message" hint="Shown in the in-app activity feed.">
      <Textarea compact rows={2} value={action.message} onChange={(e) => onChange({ ...action, message: e.target.value })} />
    </Field>
  );
}

/** A one-line label for an action — ladder coils and the action list headers. */
export function actionLabel(action: ActionDraft, catalog: RuleCatalog): { title: string; detail: string } {
  switch (action.kind) {
    case "actuator": {
      const device = catalog.deviceNameById[action.deviceId] ?? "device";
      const actuator = catalog.actuatorFor(action.deviceId, action.actuator);
      const name = actuator?.name ?? (action.actuator || "actuator");
      const value =
        action.valueKind === "boolean"
          ? String((action.bool ? actuator?.on_value : actuator?.off_value) ?? (action.bool ? "ON" : "OFF"))
          : action.valueKind === "number"
            ? String(action.num)
            : action.text || "…";
      return { title: `${name} = ${value}`, detail: device };
    }
    case "email": {
      const to = action.to.trim();
      return { title: "Email", detail: to ? to : "alert recipients" };
    }
    case "webhook":
      return { title: "Webhook", detail: action.url.replace(/^https?:\/\//, "") || "…" };
    case "notification":
      return { title: "Notification", detail: action.message || "…" };
  }
}

/** The kinds a new action can be, plus the ones planned but not built yet. */
export const ACTION_MENU: { kind: ActionDraft["kind"] | "whatsapp" | "push"; label: string; soon?: boolean }[] = [
  { kind: "actuator", label: ACTION_LABELS.actuator },
  { kind: "email", label: ACTION_LABELS.email },
  { kind: "webhook", label: ACTION_LABELS.webhook },
  { kind: "notification", label: ACTION_LABELS.notification },
  { kind: "whatsapp", label: "WhatsApp", soon: true },
  { kind: "push", label: "Push notification", soon: true },
];

export function AddActionMenu({ onAdd }: { onAdd: (kind: ActionDraft["kind"]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add an action">
      {ACTION_MENU.map((item) => (
        <Button
          key={item.kind}
          type="button"
          variant="secondary"
          disabled={item.soon}
          title={item.soon ? "Coming soon" : undefined}
          className={cn(item.soon && "opacity-60")}
          onClick={() => !item.soon && onAdd(item.kind as ActionDraft["kind"])}
        >
          + {item.label}
          {item.soon && <span className="ml-1 text-[10px] uppercase tracking-wide">soon</span>}
        </Button>
      ))}
    </div>
  );
}
