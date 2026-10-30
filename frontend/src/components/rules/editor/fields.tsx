"use client";

/**
 * Field groups shared by both rule editors — form mode renders them in
 * section cards, ladder mode renders the selected element's group in its
 * inspector. Each takes a slice of the RuleDraft and reports a new slice.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { SchedulePicker } from "@/components/ui/SchedulePicker";
import { FactList } from "@/components/ui/FactList";
import { Field } from "@/components/ui/Field";
import { Inherited } from "@/components/ui/Inherited";
import { Affix, Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Bell, Globe, Mail, Plus, Power } from "lucide-react";
import { SwitchField } from "@/components/ui/Switch";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/cn";
import {
  HYSTERESIS_OPERATORS,
  OPERATORS,
  OPERATOR_ARITY,
  type ActionDraft,
  type ActuatorActionDraft,
  type ContactDraft,
  type EmailActionDraft,
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


/** True inside a narrow panel (the ladder inspector): field rows stack one
 * per line instead of going wide on viewport breakpoints. */
export const CompactFields = createContext(false);

/** A row of fields: `wide` columns on large viewports, one column when compact. */
export function FieldRow({ wide, children }: { wide: string; children: ReactNode }) {
  const compact = useContext(CompactFields);
  return <div className={cn("grid grid-cols-1 items-start gap-4", !compact && wide)}>{children}</div>;
}

/** A safety timer in seconds (demo H Behaviour): a number with an "s" affix,
 * warning when it's low enough to let a relay cycle. */
export function NumberSafetyField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  disabled = false,
  hardware = true,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
  /** The rule switches an actuator: the warning is about relays, not alerts. */
  hardware?: boolean;
}) {
  return (
    <Field
      label={label}
      hint={
        <>
          {hint}
          {!disabled && value < min && (
            <span className="block text-status-pending">
              {hardware ? "Low values make relays cycle rapidly on noisy readings" : "Low values can send an alert for every noisy reading"} — consider {min} or
              higher.
            </span>
          )}
        </>
      }
    >
      <Affix suffix="s">
        <Input compact type="number" min={0} step="any" disabled={disabled} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </Affix>
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

/** The four starts as radio cards (demo H When). */
const TRIGGER_CARDS: { value: TriggerType; title: string; description: string }[] = [
  { value: "metric", title: "On each reading", description: "Checks every new reading." },
  { value: "schedule", title: "On a schedule", description: "Every day, certain days, or repeatedly." },
  { value: "manual", title: "Manually", description: "Only when someone runs it." },
  { value: "device_status", title: "Device connects or disconnects", description: "Online and offline events." },
];

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
      <ChoiceCards ariaLabel="Trigger" value={when.type} onChange={(type) => onChange({ ...when, type })} options={TRIGGER_CARDS} />
      {when.type === "metric" && <p className="text-sm text-ink-muted">It checks every reading from the devices in its conditions, the moment it arrives.</p>}
      {when.type === "manual" && (
        <p className="text-sm text-ink-muted">
          It fires only when someone presses <b className="font-medium text-ink">Run now</b>. Any conditions are checked at that moment.
        </p>
      )}
      {when.type === "device_status" && (
        <FieldRow wide="sm:grid-cols-2">
          <Field label="Device">
            <DeviceSelect
              ariaLabel="Watched device"
              value={when.statusDeviceId}
              catalog={catalog}
              onChange={(statusDeviceId) => onChange({ ...when, statusDeviceId })}
            />
          </Field>
          <Field label="When it" hint="Disconnects comes from its Last-Will, so it's immediate.">
            <SegmentedControl
              ariaLabel="Transition"
              value={when.transition}
              onChange={(transition) => onChange({ ...when, transition })}
              options={[
                { value: "disconnected", label: "Disconnects" },
                { value: "connected", label: "Connects" },
              ]}
            />
          </Field>
        </FieldRow>
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
  const compact = useContext(CompactFields);

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
      <FieldRow wide="sm:grid-cols-2 lg:grid-cols-[1.4fr_1.4fr_1.2fr_1fr]">
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
          <Field label="Is" className={compact ? undefined : "lg:col-span-2"}>
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
      </FieldRow>

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
            <FieldRow wide="sm:grid-cols-2">
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
            </FieldRow>
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
      <FieldRow wide="sm:grid-cols-2">
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
      </FieldRow>
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
          <SwitchField
            label="Turn it back when the condition clears"
            checked={action.revertOnClear}
            onChange={(revertOnClear) => patch({ revertOnClear })}
            onLabel="On"
            offLabel="Off"
            onHint="Runs once when the condition is known to be false again."
            offHint="It stays as the rule left it."
          />
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

/** Who a rule's email goes to (DESIGN.md §5 Inherited): the workspace's
 * alert recipients (an empty To), or the rule's own list. */
function EmailRecipients({ action, onChange }: { action: EmailActionDraft; onChange: (next: ActionDraft) => void }) {
  const { data: workspace } = useWorkspace();
  // Choosing "Use different recipients" shows the field before anything is typed.
  const [own, setOwn] = useState(action.to.trim() !== "");
  const theirs = workspace?.notification_emails ?? [];
  return (
    <Inherited
      from="the workspace"
      what="recipients"
      overridden={own}
      overrideLabel="Use different recipients"
      resetLabel="Use the workspace's"
      onOverride={() => setOwn(true)}
      onReset={() => {
        setOwn(false);
        onChange({ ...action, to: "" });
      }}
    >
      {own ? (
        <Field label="To" hint="Comma-separated.">
          <Input
            compact
            autoFocus={action.to.trim() === ""}
            value={action.to}
            onChange={(e) => onChange({ ...action, to: e.target.value })}
            placeholder="ops@example.com, oncall@example.com"
          />
        </Field>
      ) : (
        <FactList
          facts={[
            [
              "To",
              workspace ? (theirs.length ? theirs.join(", ") : "Owners and admins (nobody is listed)") : "…",
            ],
          ]}
        />
      )}
    </Inherited>
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
        <EmailRecipients action={action} onChange={onChange} />
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
      // demo H: actions read as sentences — "Turn Fan on", "Set Mode to eco".
      if (action.valueKind === "boolean") return { title: `Turn ${name} ${action.bool ? "on" : "off"}`, detail: device };
      const value = action.valueKind === "number" ? String(action.num) : action.text || "…";
      return { title: `Set ${name} to ${value}`, detail: device };
    }
    case "email": {
      const to = action.to.trim();
      return { title: "Send an email", detail: to ? to : "alert recipients" };
    }
    case "webhook":
      return { title: "Call a webhook", detail: action.url.replace(/^https?:\/\//, "") || "no address" };
    case "notification":
      return { title: "Post a notification", detail: action.message || "no message" };
  }
}

/** Add action (demo H): one button opening a menu of the four kinds. */
const ADD_ACTIONS: { kind: ActionDraft["kind"]; label: string; Icon: typeof Power }[] = [
  { kind: "actuator", label: "Switch an actuator", Icon: Power },
  { kind: "email", label: "Send an email", Icon: Mail },
  { kind: "webhook", label: "Call a webhook", Icon: Globe },
  { kind: "notification", label: "Post a notification", Icon: Bell },
];

export function AddActionMenu({ onAdd }: { onAdd: (kind: ActionDraft["kind"]) => void }) {
  return (
    <DropdownMenu
      label="Add action"
      align="start"
      triggerClassName={buttonClassName({ variant: "secondary" })}
      trigger={
        <>
          <Plus aria-hidden size={15} />
          Add action
        </>
      }
      groups={[ADD_ACTIONS.map(({ kind, label, Icon }) => ({ label, icon: <Icon size={15} />, onClick: () => onAdd(kind) }))]}
    />
  );
}
