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
import { tActive as tr } from "@iodriven/shared/i18n";

const PUBLISH_WORD = {
  periodic: "",
  get on_change() { return tr("tpls.onChange"); },
  get streaming() { return tr("tpls.streaming"); },
};
const span2 = "col-span-2";

/** "Every 30 s · 1 decimal · 0 to 50" (demo H). */
function publishSummary(m: MetricDraft): string {
  const how = m.publish === "periodic" ? tr("tpls.every", { n: m.interval || "?" }) : PUBLISH_WORD[m.publish];
  if (m.data_type === "bool") return how;
  const range = m.min !== "" || m.max !== "" ? tr("tpls.range", { min: m.min || "…", max: m.max || "…" }) : null;
  return [how, tr("tpls.decimals", { count: Number(m.decimals || 0) }), range].filter(Boolean).join(" · ");
}

// A metric on its line: unit and how it publishes (demo H).
const describe = (m: MetricDraft) =>
  [m.data_type === "bool" ? tr("tpls.onOff") : m.unit || tr("tpls.noUnit"), m.publish === "periodic" ? tr("tpls.every", { n: m.interval || "?" }) : PUBLISH_WORD[m.publish]].join(" · ");

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
    <EditorSection id="metrics" title={tr("tpls.metrics")} lead={tr("tpls.metricsLead")}>
      <div className="flex flex-col gap-2">
        {d.metrics.length === 0 && <p className="text-sm text-ink-muted">{tr("tpls.noneYet")}</p>}
        {d.metrics.length > 0 && (
          <Lines label={tr("tpls.metrics")}>
            {d.metrics.map((m, i) => (
              <RowLine key={m.uid} kind="metrics" i={i} row={m} desc={describe(m)} selected={rows.openUid === m.uid} onOpen={() => rows.open(m.uid)} props={props} />
            ))}
          </Lines>
        )}
        {d.metrics.map((m, i) => {
          if (m.uid !== rows.openUid) return null;
          const p = `metrics.${i}.`;
          return (
            <RowSheet key={m.uid} open onClose={rows.close} title={m.name || tr("tpls.newMetric")} sub={tr("tpls.metric")} readOnly={readOnly} unwired={notWired("metrics", m, props)} onRemove={() => set({ ...d, metrics: d.metrics.filter((x) => x.uid !== m.uid) })}>
              <Field label={tr("tpls.name")} {...f(p + "name")} className={span2}>
                <Input value={m.name} disabled={readOnly} placeholder={tr("tpls.metricPlaceholder")} onChange={(e) => setMetric(i, renamed(m, e.target.value))} onBlur={blur(p + "name")} />
              </Field>
              <div className={span2}>
                <KeyField kind="metrics" i={i} row={m} topic={`…/{device}/${m.key.trim() || "key"}`} onChange={(key) => setMetric(i, { ...m, key, keyAuto: false })} unlocked={rows.isUnlocked(m.uid)} onUnlock={() => rows.unlock(m.uid)} props={props} />
              </div>
              <SegField label={tr("tpls.type")} className={m.data_type === "float" ? span2 : "col-span-full"} hint={m.data_type === "bool" ? tr("tpls.boolHint") : undefined}>
                <SegmentedControl
                  ariaLabel={tr("tpls.type")}
                  size="md"
                  value={m.data_type}
                  onChange={(data_type) => !readOnly && setMetric(i, { ...m, data_type })}
                  options={[
                    { value: "float", label: tr("tpls.number"), disabled: readOnly },
                    { value: "bool", label: tr("tpls.onOffSeg"), disabled: readOnly },
                  ]}
                />
              </SegField>
              {m.data_type === "float" && (
                <Field label={tr("tpls.unit")} optional className={span2}>
                  <UnitField value={m.unit} onChange={(unit) => setMetric(i, { ...m, unit })} />
                </Field>
              )}
              {/* How often and how precisely, folded (demo H). */}
              <details
                className="col-span-full rounded-lg border border-border px-3.5 py-2.5"
                open={["interval", "deadband", "decimals", "min", "max"].some((k) => !!f(p + k).error) || undefined}
              >
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  {tr("tpls.publishing")} <span className="font-normal text-ink-muted">· {publishSummary(m)}</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">
                  <SegField label={tr("tpls.publish")} className="col-span-full">
                    <SegmentedControl
                      ariaLabel={tr("tpls.publish")}
                      size="md"
                      value={m.publish}
                      onChange={(publish) => !readOnly && setMetric(i, { ...m, publish })}
                      options={[
                        { value: "periodic", label: tr("tpls.everyOption"), disabled: readOnly },
                        { value: "on_change", label: tr("tpls.onChangeOption"), disabled: readOnly },
                        { value: "streaming", label: tr("tpls.streamingOption"), disabled: readOnly },
                      ]}
                    />
                  </SegField>
                  {m.publish === "periodic" && (
                    <Field label={tr("tpls.everyLabel")} {...f(p + "interval")}>
                      <Affix suffix="s">
                        <Input inputMode="numeric" value={m.interval} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, interval: e.target.value })} onBlur={blur(p + "interval")} />
                      </Affix>
                    </Field>
                  )}
                  {m.publish === "on_change" && m.data_type === "float" && (
                    <Field label={tr("tpls.deadband")} optional {...f(p + "deadband")}>
                      <Affix suffix={m.unit || tr("tpls.units")}>
                        <Input inputMode="decimal" value={m.deadband} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, deadband: e.target.value })} onBlur={blur(p + "deadband")} />
                      </Affix>
                    </Field>
                  )}
                  {m.data_type === "float" && (
                    <>
                      <Field label={tr("tpls.decimalsLabel")} {...f(p + "decimals")}>
                        <Input inputMode="numeric" value={m.decimals} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, decimals: e.target.value })} onBlur={blur(p + "decimals")} />
                      </Field>
                      <Field label={tr("tpls.min")} optional {...f(p + "min")}>
                        <Input inputMode="decimal" value={m.min} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, min: e.target.value })} onBlur={blur(p + "min")} />
                      </Field>
                      <Field label={tr("tpls.max")} optional {...f(p + "max")}>
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
            {tr("tpls.addMetric")}
          </Button>
        )}
      </div>
    </EditorSection>
  );
}
