"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SegField } from "@/components/catalog/template/MetricsSection";
import { EditorSection } from "@/components/editor/EditorFrame";
import { Lines } from "@/components/ui/LineRow";
import { KeyField, notWired, RowLine, RowSheet, useRowSheet } from "@/components/catalog/template/rows";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankActuator, renamed, type ActuatorDraft } from "@/lib/template-draft";

const CONTROL_LABEL = { bool: "On / Off", float: "Number", string: "List of values" } as const;
const span2 = "col-span-2";

/** What the platform can switch. */
export function ActuatorsSection(props: SectionProps) {
  const { d, set, f, blur, readOnly } = props;
  const rows = useRowSheet();
  const setActuator = (i: number, a: ActuatorDraft) => set({ ...d, actuators: d.actuators.map((x, j) => (j === i ? a : x)) });

  return (
    <EditorSection id="actuators" title="Actuators" lead="What the platform can switch.">
      <div className="flex flex-col gap-2">
        {d.actuators.length === 0 && <p className="text-sm text-ink-muted">None.</p>}
        {d.actuators.length > 0 && (
          <Lines label="Actuators">
            {d.actuators.map((a, i) => (
              <RowLine
                key={a.uid}
                kind="actuators"
                i={i}
                row={a}
                desc={a.value_type === "bool" ? "On / Off" : a.value_type === "string" ? `values: ${a.allowed || "—"}` : "a number"}
                selected={rows.openUid === a.uid}
                onOpen={() => rows.open(a.uid)}
                props={props}
              />
            ))}
          </Lines>
        )}
        {d.actuators.map((a, i) => {
          if (a.uid !== rows.openUid) return null;
          const p = `actuators.${i}.`;
          return (
            <RowSheet key={a.uid} open onClose={rows.close} title={a.name || "New actuator"} sub="Actuator" readOnly={readOnly} unwired={notWired("actuators", a, props)} onRemove={() => set({ ...d, actuators: d.actuators.filter((x) => x.uid !== a.uid) })}>
              <Field label="Name" {...f(p + "name")} className={span2}>
                <Input value={a.name} disabled={readOnly} placeholder="e.g. Fan" onChange={(e) => setActuator(i, renamed(a, e.target.value))} onBlur={blur(p + "name")} />
              </Field>
              <div className={span2}>
                <KeyField kind="actuators" i={i} row={a} topic={`…/{device}/cmd/${a.key.trim() || "key"}`} onChange={(key) => setActuator(i, { ...a, key, keyAuto: false })} unlocked={rows.isUnlocked(a.uid)} onUnlock={() => rows.unlock(a.uid)} props={props} />
              </div>
              <SegField label="Control" className="col-span-full" hint="Commands go out on QoS 1 with a 30 s time limit.">
                <SegmentedControl
                  ariaLabel="Control"
                  size="md"
                  value={a.value_type}
                  onChange={(value_type) => !readOnly && setActuator(i, { ...a, value_type })}
                  options={(Object.keys(CONTROL_LABEL) as ActuatorDraft["value_type"][]).map((k) => ({ value: k, label: CONTROL_LABEL[k], disabled: readOnly }))}
                />
              </SegField>
              {a.value_type === "bool" && (
                <details className="col-span-full rounded-lg border border-border px-3.5 py-2.5" open={!!(f(p + "on").error || f(p + "off").error) || undefined}>
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Payloads{" "}
                    <span className="font-normal text-ink-muted">
                      · sends {a.on || "…"} for On, {a.off || "…"} for Off
                    </span>
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3.5">
                    <Field label="Sends for On" {...f(p + "on")}>
                      <Input mono value={a.on} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, on: e.target.value })} onBlur={blur(p + "on")} />
                    </Field>
                    <Field label="Sends for Off" {...f(p + "off")}>
                      <Input mono value={a.off} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, off: e.target.value })} onBlur={blur(p + "off")} />
                    </Field>
                  </div>
                </details>
              )}
              {a.value_type === "string" && (
                <Field label="Allowed values" hint="Separated by commas, e.g. open, closed, half" {...f(p + "allowed")} className="col-span-full">
                  <Input mono value={a.allowed} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, allowed: e.target.value })} onBlur={blur(p + "allowed")} />
                </Field>
              )}
              {a.value_type === "float" && <p className="col-span-full text-xs text-ink-muted">Sends the number you choose.</p>}
            </RowSheet>
          );
        })}
        {!readOnly && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              const a = blankActuator();
              set({ ...d, actuators: [...d.actuators, a] });
              rows.open(a.uid);
            }}
          >
            <Plus aria-hidden size={14} />
            Add actuator
          </Button>
        )}
      </div>
    </EditorSection>
  );
}
