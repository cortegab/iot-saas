"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Affix, Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import { UnitField } from "@/components/catalog/UnitField";
import { EditorSection } from "@/components/editor/EditorFrame";
import { Lines } from "@/components/ui/LineRow";
import { KeyField, notWired, RowLine, RowSheet, useRowSheet } from "@/components/catalog/template/rows";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankMetric, renamed, type MetricDraft } from "@/lib/template-draft";

const PUBLISH_WORD = { periodic: "", on_change: "on change", streaming: "streaming" } as const;
const span2 = "col-span-2";

/** "Every 30 s · 1 decimal · 0 to 50" (demo H). */
function publishSummary(m: MetricDraft): string {
  const how = m.publish === "periodic" ? `every ${m.interval || "?"} s` : PUBLISH_WORD[m.publish];
  if (m.data_type === "bool") return how;
  const range = m.min !== "" || m.max !== "" ? `${m.min || "…"} to ${m.max || "…"}` : null;
  return [how, `${m.decimals || 0} decimal${m.decimals === "1" ? "" : "s"}`, range].filter(Boolean).join(" · ");
}

// A metric on its line: unit and how it publishes (demo H).
const describe = (m: MetricDraft) =>
  [m.data_type === "bool" ? "On/Off" : m.unit || "no unit", m.publish === "periodic" ? `every ${m.interval || "?"} s` : PUBLISH_WORD[m.publish]].join(" · ");

/** A labelled segmented control in the sheet's grid: a plain caption, not a
 * <label> (a label around the buttons would name them all after it). */
export function SegField({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-[5px]", className)}>
      <span className="text-meta font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}

/** What the device publishes; each key is the last segment of an MQTT topic. */
export function MetricsSection(props: SectionProps) {
  const { d, set, f, blur, readOnly } = props;
  const rows = useRowSheet();
  const setMetric = (i: number, m: MetricDraft) => set({ ...d, metrics: d.metrics.map((x, j) => (j === i ? m : x)) });

  return (
    <EditorSection id="metrics" title="Metrics" lead="What the device publishes. Rules, dashboards and history point at these keys.">
      <div className="flex flex-col gap-2">
        {d.metrics.length === 0 && <p className="text-sm text-ink-muted">None yet.</p>}
        {d.metrics.length > 0 && (
          <Lines label="Metrics">
            {d.metrics.map((m, i) => (
              <RowLine key={m.uid} kind="metrics" i={i} row={m} desc={describe(m)} selected={rows.openUid === m.uid} onOpen={() => rows.open(m.uid)} props={props} />
            ))}
          </Lines>
        )}
        {d.metrics.map((m, i) => {
          if (m.uid !== rows.openUid) return null;
          const p = `metrics.${i}.`;
          return (
            <RowSheet key={m.uid} open onClose={rows.close} title={m.name || "New metric"} sub="Metric" readOnly={readOnly} unwired={notWired("metrics", m, props)} onRemove={() => set({ ...d, metrics: d.metrics.filter((x) => x.uid !== m.uid) })}>
              <Field label="Name" {...f(p + "name")} className={span2}>
                <Input value={m.name} disabled={readOnly} placeholder="e.g. Temperature" onChange={(e) => setMetric(i, renamed(m, e.target.value))} onBlur={blur(p + "name")} />
              </Field>
              <div className={span2}>
                <KeyField kind="metrics" i={i} row={m} topic={`…/{device}/${m.key.trim() || "key"}`} onChange={(key) => setMetric(i, { ...m, key, keyAuto: false })} unlocked={rows.isUnlocked(m.uid)} onUnlock={() => rows.unlock(m.uid)} props={props} />
              </div>
              <SegField label="Type" className={m.data_type === "float" ? span2 : "col-span-full"} hint={m.data_type === "bool" ? "Reads On or Off; no unit." : undefined}>
                <SegmentedControl
                  ariaLabel="Type"
                  size="md"
                  value={m.data_type}
                  onChange={(data_type) => !readOnly && setMetric(i, { ...m, data_type })}
                  options={[
                    { value: "float", label: "Number", disabled: readOnly },
                    { value: "bool", label: "On / Off", disabled: readOnly },
                  ]}
                />
              </SegField>
              {m.data_type === "float" && (
                <Field label="Unit" optional className={span2}>
                  <UnitField value={m.unit} onChange={(unit) => setMetric(i, { ...m, unit })} />
                </Field>
              )}
              {/* How often and how precisely, folded (demo H). */}
              <details
                className="col-span-full rounded-lg border border-border px-3.5 py-2.5"
                open={["interval", "deadband", "decimals", "min", "max"].some((k) => !!f(p + k).error) || undefined}
              >
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  Publishing and range <span className="font-normal text-ink-muted">· {publishSummary(m)}</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">
                  <SegField label="Publish" className="col-span-full">
                    <SegmentedControl
                      ariaLabel="Publish"
                      size="md"
                      value={m.publish}
                      onChange={(publish) => !readOnly && setMetric(i, { ...m, publish })}
                      options={[
                        { value: "periodic", label: "Every…", disabled: readOnly },
                        { value: "on_change", label: "On change", disabled: readOnly },
                        { value: "streaming", label: "Streaming", disabled: readOnly },
                      ]}
                    />
                  </SegField>
                  {m.publish === "periodic" && (
                    <Field label="Every" {...f(p + "interval")}>
                      <Affix suffix="s">
                        <Input inputMode="numeric" value={m.interval} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, interval: e.target.value })} onBlur={blur(p + "interval")} />
                      </Affix>
                    </Field>
                  )}
                  {m.publish === "on_change" && m.data_type === "float" && (
                    <Field label="Change of at least" optional {...f(p + "deadband")}>
                      <Affix suffix={m.unit || "units"}>
                        <Input inputMode="decimal" value={m.deadband} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, deadband: e.target.value })} onBlur={blur(p + "deadband")} />
                      </Affix>
                    </Field>
                  )}
                  {m.data_type === "float" && (
                    <>
                      <Field label="Decimals" {...f(p + "decimals")}>
                        <Input inputMode="numeric" value={m.decimals} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, decimals: e.target.value })} onBlur={blur(p + "decimals")} />
                      </Field>
                      <Field label="Min" optional {...f(p + "min")}>
                        <Input inputMode="decimal" value={m.min} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, min: e.target.value })} onBlur={blur(p + "min")} />
                      </Field>
                      <Field label="Max" optional {...f(p + "max")}>
                        <Input inputMode="decimal" value={m.max} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, max: e.target.value })} onBlur={blur(p + "max")} />
                      </Field>
                    </>
                  )}
                </div>
              </details>
            </RowSheet>
          );
        })}
        {!readOnly && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              const m = blankMetric();
              set({ ...d, metrics: [...d.metrics, m] });
              rows.open(m.uid);
            }}
          >
            <Plus aria-hidden size={14} />
            Add metric
          </Button>
        )}
      </div>
    </EditorSection>
  );
}
