"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  canClear,
  OPERATOR_ARITY,
  OPERATOR_SYMBOL,
  OPERATORS,
  type ActuatorActionDraft,
  type ContactDraft,
  type DraftNode,
  type RuleDraft,
} from "@/lib/rule-draft";
import { cronHuman } from "@/lib/schedule";
import type { RuleCatalog } from "./useRuleCatalog";

const ONE_VALUE_OPS = OPERATORS.filter((o) => OPERATOR_ARITY[o.value] === "one");

/** A phrase of the sentence that opens an in-place editor (DESIGN.md §9.3).
 * Keyboard-focusable; Esc closes and returns focus to the chip. */
function Chip({ label, children }: { label: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !chip.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <span className="relative inline-block">
      <button
        ref={chip}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded-md border border-transparent bg-accent-muted px-1.5 py-0.5 font-semibold text-accent-strong hover:border-accent/50",
          open && "border-accent",
        )}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Edit phrase"
          className="absolute left-0 top-full z-30 mt-1.5 flex min-w-[240px] flex-col gap-2.5 rounded-lg border border-border bg-surface p-3 text-sm font-normal text-ink shadow-pop"
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}

function ApplyCancel({ onApply, close }: { onApply: () => void; close: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => {
          onApply();
          close();
        }}
      >
        Apply
      </Button>
    </div>
  );
}

function OpenFull({ onOpenFull, close }: { onOpenFull: () => void; close: () => void }) {
  return (
    <>
      <p className="text-[13px] text-ink-muted">This part has more options than fit here.</p>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          close();
          onOpenFull();
        }}
      >
        Open full condition
      </Button>
    </>
  );
}

function replaceContact(node: DraftNode | null, next: ContactDraft): DraftNode | null {
  if (!node) return node;
  if (node.kind === "contact") return node.id === next.id ? next : node;
  return { ...node, children: node.children.map((c) => replaceContact(c, next)!) };
}

/** The rule as one sentence of editable chips (DESIGN.md §9.3): readings
 * (operator and value), the hold time and actuator values edit in place;
 * everything else opens the full form. */
export function EditableSentence({
  draft,
  catalog,
  update,
  onOpenFull,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: (d: RuleDraft) => void;
  onOpenFull: () => void;
}) {
  const metricName = (c: ContactDraft) => catalog.metricFor(c.deviceId, c.metric)?.name ?? (c.metric || "a reading");
  const deviceName = (id: string) => catalog.deviceNameById[id] ?? "a device";

  function contactChip(c: ContactDraft) {
    const simple = OPERATOR_ARITY[c.operator] === "one" && c.rhsKind === "static";
    const unit = catalog.metricFor(c.deviceId, c.metric)?.unit;
    const label = (
      <>
        {metricName(c)} on {deviceName(c.deviceId)} {OPERATOR_SYMBOL[c.operator] ?? c.operator}
        {OPERATOR_ARITY[c.operator] === "one" ? ` ${c.rhsKind === "metric" ? "another reading" : `${c.value}${unit ? ` ${unit}` : ""}`}` : ""}
      </>
    );
    return (
      <Chip key={c.id} label={label}>
        {(close) =>
          simple ? <ContactEditor c={c} close={close} onApply={(next) => update({ ...draft, condition: replaceContact(draft.condition, next) })} /> : <OpenFull onOpenFull={onOpenFull} close={close} />
        }
      </Chip>
    );
  }

  function conditionPhrase(node: DraftNode | null): ReactNode {
    if (!node) return null;
    if (node.kind === "contact") return contactChip(node);
    return node.children.map((child, i) => (
      <Fragment key={child.id}>
        {i > 0 && <span> {node.op === "AND" ? "and" : "or"} </span>}
        {child.kind === "group" ? <>({conditionPhrase(child)})</> : conditionPhrase(child)}
      </Fragment>
    ));
  }

  function actionPhrase(a: RuleDraft["actions"][number], i: number) {
    if (a.kind !== "actuator") {
      const words = a.kind === "email" ? "send an email" : a.kind === "webhook" ? "call a webhook" : "add a notification";
      return <span key={a.id}>{i > 0 ? ", " : ""}{words}</span>;
    }
    const value = a.valueKind === "boolean" ? (a.bool ? "on" : "off") : a.valueKind === "number" ? String(a.num) : a.text;
    return (
      <Fragment key={a.id}>
        {i > 0 ? ", " : ""}
        <Chip label={<>turn {catalog.actuatorFor(a.deviceId, a.actuator)?.name ?? (a.actuator || "an actuator")} {value}</>}>
          {(close) =>
            a.valueKind === "boolean" ? (
              <ActuatorEditor a={a} close={close} onApply={(bool) => update({ ...draft, actions: draft.actions.map((x) => (x.id === a.id ? { ...a, bool } : x)) })} />
            ) : (
              <OpenFull onOpenFull={onOpenFull} close={close} />
            )
          }
        </Chip>
      </Fragment>
    );
  }

  // What happens when the condition clears (re-arm rules on readings only).
  const reverts = canClear(draft)
    ? draft.actions.flatMap((a) => {
        if (a.kind !== "actuator" || !a.revertOnClear) return [];
        const back = a.valueKind === "boolean" ? ((a.clearBool ?? !a.bool) ? "on" : "off") : a.valueKind === "number" ? String(a.clearNum) : a.clearText;
        return [`turn ${catalog.actuatorFor(a.deviceId, a.actuator)?.name ?? (a.actuator || "it")} back ${back}`];
      })
    : [];
  if (canClear(draft) && draft.clearNotify && draft.clearMessage.trim()) reverts.push("add a notification");
  const clearPhrase = reverts.length
    ? `when that's no longer true${draft.clearDelay > 0 ? ` for ${draft.clearDelay}s` : ""}, ${reverts.join(", ")}`
    : null;

  const w = draft.when;
  const when =
    w.type === "schedule" ? (
      <Chip label={cronHuman(w.cron)}>{(close) => <OpenFull onOpenFull={onOpenFull} close={close} />}</Chip>
    ) : w.type === "device_status" ? (
      <span>
        {deviceName(w.statusDeviceId)} {w.transition === "connected" ? "connects" : "disconnects"}
      </span>
    ) : w.type === "manual" ? (
      <span>someone runs it</span>
    ) : (
      conditionPhrase(draft.condition)
    );

  return (
    <p className="text-[15px] leading-[2] text-ink" aria-label="Rule sentence">
      <span>When </span>
      {when ?? <span className="text-ink-muted">…</span>}
      {w.type === "metric" && (
        <>
          <span> for </span>
          <Chip label={`${draft.forDuration} s`}>
            {(close) => <DurationEditor seconds={draft.forDuration} close={close} onApply={(forDuration) => update({ ...draft, forDuration })} />}
          </Chip>
        </>
      )}
      <span>, </span>
      {draft.actions.length ? draft.actions.map(actionPhrase) : <span className="text-ink-muted">do nothing yet</span>}
      {clearPhrase && <span>; {clearPhrase}</span>}
      <span>.</span>
    </p>
  );
}

function ContactEditor({ c, close, onApply }: { c: ContactDraft; close: () => void; onApply: (c: ContactDraft) => void }) {
  const [op, setOp] = useState(c.operator);
  const [value, setValue] = useState(String(c.value));
  const ok = value.trim() !== "" && Number.isFinite(Number(value));
  return (
    <>
      <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
        <Select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value)}>
          {ONE_VALUE_OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Input aria-label="Value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {!ok && <p className="text-[12.5px] text-status-error">Enter a number.</p>}
      <ApplyCancel close={close} onApply={() => ok && onApply({ ...c, operator: op, value: Number(value) })} />
    </>
  );
}

function ActuatorEditor({ a, close, onApply }: { a: ActuatorActionDraft; close: () => void; onApply: (on: boolean) => void }) {
  const [on, setOn] = useState(a.bool ? "on" : "off");
  return (
    <>
      <SegmentedControl
        ariaLabel="Value"
        value={on}
        onChange={setOn}
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
      />
      <ApplyCancel close={close} onApply={() => onApply(on === "on")} />
    </>
  );
}

function DurationEditor({ seconds, close, onApply }: { seconds: number; close: () => void; onApply: (s: number) => void }) {
  const [v, setV] = useState(String(seconds));
  const n = Number(v);
  const ok = Number.isInteger(n) && n >= 0;
  return (
    <>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Hold time (seconds)
        <Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      {ok && n < 5 && <p className="text-[12.5px] text-status-pending">Under 5 s, a single noisy reading can fire it.</p>}
      <ApplyCancel close={close} onApply={() => ok && onApply(n)} />
    </>
  );
}
