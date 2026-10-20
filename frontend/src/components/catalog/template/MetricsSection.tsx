"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Affix, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { UnitField } from "@/components/catalog/UnitField";
import { EditorSection } from "@/components/editor/EditorFrame";
import { KeyField, notWired, RowCard, RowSummary, useRowExpansion } from "@/components/catalog/template/rows";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankMetric, renamed, type MetricDraft } from "@/lib/template-draft";

const PUBLISH_LABEL = { periodic: "Every N seconds", on_change: "When it changes", streaming: "As fast as it samples" } as const;
const span2 = "col-span-2";

/** What the device publishes; each key is the last segment of an MQTT topic. */
export function MetricsSection(props: SectionProps) {
  const { d, set, f, blur, readOnly } = props;
  const rows = useRowExpansion("metrics", props);
  const setMetric = (i: number, m: MetricDraft) => set({ ...d, metrics: d.metrics.map((x, j) => (j === i ? m : x)) });

  return (
    <EditorSection id="metrics" title="Metrics" lead="What the device publishes. Each key is the last segment of an MQTT topic." actions={rows.toggleAll}>
      <div className="flex flex-col gap-2">
        {d.metrics.length === 0 && <p className="text-sm text-ink-muted">No metrics. Add one for each reading the device sends.</p>}
        {d.metrics.map((m, i) => {
          const desc =
            m.data_type === "bool"
              ? "On/off flag"
              : [m.unit, m.min !== "" || m.max !== "" ? `${m.min || "…"} to ${m.max || "…"}` : null, PUBLISH_LABEL[m.publish].toLowerCase()].filter(Boolean).join(" · ");
          if (!rows.isOpen(m, i)) return <RowSummary key={m.uid} kind="metrics" i={i} row={m} desc={desc} onOpen={() => rows.toggle(m.uid)} props={props} />;
          const p = `metrics.${i}.`;
          return (
            <RowCard key={m.uid} title={m.name || "New metric"} readOnly={readOnly} unwired={notWired("metrics", m, props)} onCollapse={() => rows.collapse(m.uid)} onRemove={() => set({ ...d, metrics: d.metrics.filter((x) => x.uid !== m.uid) })}>
              <Field label="Name" {...f(p + "name")} className={span2}>
                <Input value={m.name} disabled={readOnly} placeholder="e.g. Temperature" onChange={(e) => setMetric(i, renamed(m, e.target.value))} onBlur={blur(p + "name")} />
              </Field>
              <div className={span2}>
                <KeyField kind="metrics" i={i} row={m} topic={`…/{device}/${m.key.trim() || "key"}`} onChange={(key) => setMetric(i, { ...m, key, keyAuto: false })} unlocked={rows.isUnlocked(m.uid)} onUnlock={() => rows.unlock(m.uid)} props={props} />
              </div>
              <Field label="Type">
                <Select value={m.data_type} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, data_type: e.target.value as MetricDraft["data_type"] })}>
                  <option value="float">Number</option>
                  <option value="bool">On/off</option>
                </Select>
              </Field>
              {m.data_type === "float" ? (
                <>
                  <Field label="Unit" optional>
                    <UnitField value={m.unit} onChange={(unit) => setMetric(i, { ...m, unit })} />
                  </Field>
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
              ) : (
                <p className="col-span-3 self-end pb-2 text-xs text-ink-muted">Sends 0 or 1. No unit or range.</p>
              )}
              <Field label="Publish" className={span2}>
                <Select value={m.publish} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, publish: e.target.value as MetricDraft["publish"] })}>
                  {(Object.keys(PUBLISH_LABEL) as MetricDraft["publish"][]).map((k) => (
                    <option key={k} value={k}>
                      {PUBLISH_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              {m.publish === "on_change" ? (
                <Field label="Change of at least" optional {...f(p + "deadband")} className={span2}>
                  <Affix suffix={m.unit || "units"}>
                    <Input inputMode="decimal" value={m.deadband} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, deadband: e.target.value })} onBlur={blur(p + "deadband")} />
                  </Affix>
                </Field>
              ) : (
                <Field label="Every" optional {...f(p + "interval")} className={span2}>
                  <Affix suffix="s">
                    <Input inputMode="numeric" value={m.interval} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, interval: e.target.value })} onBlur={blur(p + "interval")} />
                  </Affix>
                </Field>
              )}
            </RowCard>
          );
        })}
        {!readOnly && (
          <Button
            variant="link"
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
