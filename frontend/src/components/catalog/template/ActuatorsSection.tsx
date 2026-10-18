"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EditorSection } from "@/components/editor/EditorFrame";
import { KeyField, RowCard, RowSummary, useRowExpansion } from "@/components/catalog/template/rows";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankActuator, renamed, type ActuatorDraft } from "@/lib/template-draft";

const CONTROL_LABEL = { bool: "On/off switch", float: "Level (number)", string: "Choice from a list" } as const;
const span2 = "col-span-2";

/** What the platform can switch. */
export function ActuatorsSection(props: SectionProps) {
  const { d, set, f, blur, readOnly } = props;
  const rows = useRowExpansion("actuators", props);
  const setActuator = (i: number, a: ActuatorDraft) => set({ ...d, actuators: d.actuators.map((x, j) => (j === i ? a : x)) });

  return (
    <EditorSection id="actuators" title="Actuators" lead="What the platform can switch. Commands go out on QoS 1 with a 30 s TTL." actions={rows.toggleAll}>
      <div className="flex flex-col gap-2">
        {d.actuators.length === 0 && <p className="text-sm text-ink-muted">No actuators. Sensors-only devices don&apos;t need any.</p>}
        {d.actuators.map((a, i) => {
          const desc = a.value_type === "bool" ? `On/off · sends ${a.on || "…"} / ${a.off || "…"}` : CONTROL_LABEL[a.value_type];
          if (!rows.isOpen(a, i)) return <RowSummary key={a.uid} kind="actuators" i={i} row={a} desc={desc} onOpen={() => rows.toggle(a.uid)} props={props} />;
          const p = `actuators.${i}.`;
          return (
            <RowCard key={a.uid} title={a.name || "New actuator"} readOnly={readOnly} onCollapse={() => rows.collapse(a.uid)} onRemove={() => set({ ...d, actuators: d.actuators.filter((x) => x.uid !== a.uid) })}>
              <Field label="Name" {...f(p + "name")} className={span2}>
                <Input value={a.name} disabled={readOnly} placeholder="e.g. Fan" onChange={(e) => setActuator(i, renamed(a, e.target.value))} onBlur={blur(p + "name")} />
              </Field>
              <div className={span2}>
                <KeyField kind="actuators" i={i} row={a} topic={`…/{device}/cmd/${a.key.trim() || "key"}`} onChange={(key) => setActuator(i, { ...a, key, keyAuto: false })} unlocked={rows.isUnlocked(a.uid)} onUnlock={() => rows.unlock(a.uid)} props={props} />
              </div>
              <Field label="Control" className={span2}>
                <Select value={a.value_type} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, value_type: e.target.value as ActuatorDraft["value_type"] })}>
                  {(Object.keys(CONTROL_LABEL) as ActuatorDraft["value_type"][]).map((k) => (
                    <option key={k} value={k}>
                      {CONTROL_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              {a.value_type === "bool" && (
                <>
                  <Field label="Sends for On" {...f(p + "on")}>
                    <Input mono value={a.on} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, on: e.target.value })} onBlur={blur(p + "on")} />
                  </Field>
                  <Field label="Sends for Off" {...f(p + "off")}>
                    <Input mono value={a.off} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, off: e.target.value })} onBlur={blur(p + "off")} />
                  </Field>
                </>
              )}
              {a.value_type === "string" && (
                <Field label="Allowed values" hint="Separated by commas, e.g. open, closed, half" {...f(p + "allowed")} className={span2}>
                  <Input mono value={a.allowed} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, allowed: e.target.value })} onBlur={blur(p + "allowed")} />
                </Field>
              )}
              {a.value_type === "float" && <p className="col-span-2 self-end pb-2 text-xs text-ink-muted">Sends the number you choose.</p>}
            </RowCard>
          );
        })}
        {!readOnly && (
          <Button
            variant="link"
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
