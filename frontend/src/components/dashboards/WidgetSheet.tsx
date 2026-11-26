"use client";

import { useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Cpu, Gauge, LineChart, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LineRow, Lines } from "@/components/ui/LineRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { WIDGET_LABEL } from "@/components/dashboards/DashboardGrid";
import { isBoolMetric } from "@/lib/format-reading";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type Widget = components["schemas"]["Widget"];
type WidgetType = Widget["type"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** What each type needs. `numeric`: on/off metrics don't fit a gauge; value
 * cards and trend charts take both (a trend draws On/Off as steps). */
export const WIDGET_TYPES: {
  type: WidgetType;
  icon: typeof Activity;
  what: string;
  metric?: boolean;
  numeric?: boolean;
  range?: boolean;
  actuators?: boolean;
  w: number;
  h: number;
}[] = [
  { type: "value_card", icon: Activity, get what() { return tr("wsheet.whatValue"); }, metric: true, w: 4, h: 2 },
  { type: "trend_chart", icon: LineChart, get what() { return tr("wsheet.whatTrend"); }, metric: true, w: 8, h: 4 },
  { type: "gauge", icon: Gauge, get what() { return tr("wsheet.whatGauge"); }, metric: true, numeric: true, range: true, w: 4, h: 3 },
  { type: "device_status", icon: Cpu, get what() { return tr("wsheet.whatStatus"); }, w: 4, h: 2 },
  { type: "actuator_control", icon: ToggleRight, get what() { return tr("wsheet.whatControl"); }, actuators: true, w: 4, h: 3 },
];

/** DESIGN.md §8 widget sizes (of 12 columns). On a phone every widget is full width. */
export const WIDGET_SIZES = [
  { w: 3, label: "S" },
  { w: 4, label: "M" },
  { w: 8, label: "L" },
  { w: 12, get label() { return tr("wsheet.full"); } },
] as const;

type Draft = Omit<Widget, "x" | "y">;

interface Sources {
  devices: DeviceResponse[];
  templates: CatalogEntryResponse[];
}

function specOf(type: WidgetType) {
  return WIDGET_TYPES.find((t) => t.type === type)!;
}

function tplOf(d: DeviceResponse | undefined, templates: CatalogEntryResponse[]) {
  return templates.find((t) => t.id === d?.catalog_entry_id);
}

function metricsOf(type: WidgetType, d: DeviceResponse | undefined, templates: CatalogEntryResponse[]) {
  const spec = specOf(type);
  return (tplOf(d, templates)?.metrics ?? []).filter((m) => !spec.numeric || !isBoolMetric(m));
}

/** Devices that can feed this type of widget. */
function devicesFor(type: WidgetType, { devices, templates }: Sources) {
  const spec = specOf(type);
  return devices.filter((d) =>
    spec.actuators ? (tplOf(d, templates)?.actuators.length ?? 0) > 0 : !spec.metric || metricsOf(type, d, templates).length > 0,
  );
}

/** Keeps a widget valid after its type or device changed: a device that can
 * feed it, a reading of the right kind, a gauge range from the metric. */
export function fixWidget(w: Draft, src: Sources): Draft {
  const spec = specOf(w.type);
  const eligible = devicesFor(w.type, src);
  const device = eligible.find((d) => d.id === w.device_id) ?? eligible[0];
  const next: Draft = { ...w, device_id: device?.id ?? w.device_id };
  if (!spec.metric) return { ...next, metric: null, min: null, max: null };
  const metrics = metricsOf(w.type, device, src.templates);
  const metric = metrics.find((m) => wireId(m) === w.metric) ?? metrics[0];
  next.metric = metric ? wireId(metric) : null;
  if (spec.range) {
    if (next.min == null || w.metric !== next.metric) next.min = metric?.min ?? 0;
    if (next.max == null || w.metric !== next.metric) next.max = metric?.max ?? 100;
  } else {
    next.min = null;
    next.max = null;
  }
  return next;
}

/** Why this widget can't be added or kept as it is, or null. */
function problemOf(w: Draft, src: Sources): string | null {
  const spec = specOf(w.type);
  const device = devicesFor(w.type, src).find((d) => d.id === w.device_id);
  if (!device) {
    if (spec.actuators) return tr("wsheet.noActuators");
    if (spec.numeric && src.devices.length > 0) return tr("wsheet.noNumeric");
    return tr("wsheet.addDevice");
  }
  if (spec.metric && !w.metric) return tr("wsheet.noMetric", { device: device.name });
  if (spec.range && (w.min == null || w.max == null || Number.isNaN(w.min) || Number.isNaN(w.max))) return tr("wsheet.rangeNumbers");
  if (spec.range && (w.max ?? 0) <= (w.min ?? 0)) return tr("wsheet.maxAbove");
  return null;
}

/** The generated title: reading · device, or the device (DESIGN.md §8). */
export function widgetTitle(w: Draft, src: Sources): string {
  const device = src.devices.find((d) => d.id === w.device_id);
  const metric = w.metric ? tplOf(device, src.templates)?.metrics.find((m) => wireId(m) === w.metric) : undefined;
  if (w.type === "device_status" || w.type === "actuator_control") return device?.name ?? WIDGET_LABEL[w.type];
  return [metric?.name ?? w.metric, device?.name].filter(Boolean).join(" · ") || WIDGET_LABEL[w.type];
}

/** Device, then the reading (or nothing, for status and controls), then a gauge's range. */
function SourceFields({ w, src, onChange }: { w: Draft; src: Sources; onChange: (next: Draft) => void }) {
  const spec = specOf(w.type);
  const eligible = devicesFor(w.type, src);
  const metrics = metricsOf(w.type, src.devices.find((d) => d.id === w.device_id), src.templates);
  return (
    <div className="grid gap-3 @min-[420px]:grid-cols-2">
      <Field label={tr("wsheet.device")}>
        <Select value={w.device_id} disabled={eligible.length === 0} onChange={(e) => onChange(fixWidget({ ...w, device_id: e.target.value }, src))}>
          {eligible.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      {spec.metric && (
        <Field label={tr("wsheet.reading")}>
          <Select value={w.metric ?? ""} disabled={metrics.length === 0} onChange={(e) => onChange(fixWidget({ ...w, metric: e.target.value }, src))}>
            {metrics.map((m) => (
              <option key={wireId(m)} value={wireId(m)}>
                {m.name} ({wireId(m)})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={tr("wsheet.title")} optional hint={tr("wsheet.titleHint")}>
        <Input value={w.title ?? ""} maxLength={60} placeholder={widgetTitle(w, src)} onChange={(e) => onChange({ ...w, title: e.target.value || null })} />
      </Field>
      {spec.range && (
        <>
          <Field label={tr("wsheet.min")}>
            <Input inputMode="decimal" value={String(w.min ?? "")} onChange={(e) => onChange({ ...w, min: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <Field label={tr("wsheet.max")}>
            <Input inputMode="decimal" value={String(w.max ?? "")} onChange={(e) => onChange({ ...w, max: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
        </>
      )}
    </div>
  );
}

function SizeField({ w, onChange }: { w: number; onChange: (w: number) => void }) {
  return (
    <Field label={tr("wsheet.size")} hint={tr("wsheet.sizeHint")}>
      <SegmentedControl
        ariaLabel={tr("wsheet.size")}
        value={String(w)}
        onChange={(v) => onChange(Number(v))}
        options={WIDGET_SIZES.map((s) => ({ value: String(s.w), label: s.label }))}
      />
    </Field>
  );
}

/** A widget's item sheet (DESIGN.md §8): changes apply as you make them;
 * Remove widget, then Done. */
export function WidgetSheet({
  widget,
  src,
  onChange,
  onRemove,
  onClose,
}: {
  widget: Widget | null;
  src: Sources;
  onChange: (next: Widget) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  if (!widget) return <ItemSheet open={false} onClose={onClose} title={tr("wsheet.widget")}>{null}</ItemSheet>;
  const set = (next: Draft) => onChange({ ...widget, ...next });
  const problem = problemOf(widget, src);
  return (
    <ItemSheet
      open
      onClose={onClose}
      title={widgetTitle(widget, src)}
      sub={tr("wsheet.widgetSub")}
      footer={
        <>
          <Button
            variant="link-danger"
            className="mr-auto text-meta"
            onClick={() => {
              onRemove(widget.id);
              onClose();
            }}
          >
            {tr("wsheet.remove")}
          </Button>
          <Button onClick={onClose}>{tr("wsheet.done")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={tr("wsheet.type")}>
          <Select
            value={widget.type}
            onChange={(e) => {
              const type = e.target.value as WidgetType;
              set(fixWidget({ ...widget, type, h: specOf(type).h }, src));
            }}
          >
            {WIDGET_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {WIDGET_LABEL[t.type]}
              </option>
            ))}
          </Select>
        </Field>
        <SourceFields w={widget} src={src} onChange={set} />
        <SizeField w={widget.w} onChange={(w) => set({ ...widget, w })} />
        {problem && (
          <p role="alert" className="text-xs text-status-error">
            {problem}
          </p>
        )}
      </div>
    </ItemSheet>
  );
}

/** Add a widget in three steps (DESIGN.md §8): Type → Source → Size. */
export function AddWidgetSheet({
  open,
  src,
  onAdd,
  onClose,
}: {
  open: boolean;
  src: Sources;
  onAdd: (w: Draft) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const close = () => {
    setStep(0);
    setDraft(null);
    onClose();
  };
  const steps = [tr("wsheet.type"), tr("wsheet.source"), tr("wsheet.size")];
  const problem = draft ? problemOf(draft, src) : null;

  let body;
  if (step === 0 || !draft) {
    body = (
      <Lines label={tr("wsheet.widgetType")}>
        {WIDGET_TYPES.map((t) => (
          <LineRow
            key={t.type}
            icon={<t.icon size={16} />}
            title={WIDGET_LABEL[t.type]}
            sub={t.what}
            onOpen={() => {
              setDraft(fixWidget({ id: crypto.randomUUID(), type: t.type, w: t.w, h: t.h, device_id: "", metric: null, min: null, max: null }, src));
              setStep(1);
            }}
          />
        ))}
      </Lines>
    );
  } else if (step === 1) {
    body = <SourceFields w={draft} src={src} onChange={setDraft} />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <SizeField w={draft.w} onChange={(w) => setDraft({ ...draft, w })} />
        <p className="text-sm text-ink-muted">
          {richT(tr, "wsheet.adds", { title: <b className="font-medium text-ink">{widgetTitle(draft, src)}</b> }, { type: WIDGET_LABEL[draft.type].toLowerCase() })}
        </p>
      </div>
    );
  }

  return (
    <ItemSheet
      open={open}
      onClose={close}
      title={tr("wsheet.addTitle")}
      sub={tr("wsheet.step", { n: step + 1, name: steps[step] })}
      footer={
        <>
          {step > 0 && (
            <Button variant="ghost" className="mr-auto" onClick={() => setStep(step - 1)}>
              <ChevronLeft aria-hidden size={15} />
              {tr("wsheet.back")}
            </Button>
          )}
          {step === 1 && (
            <Button disabled={!!problem} onClick={() => setStep(2)}>
              {tr("wsheet.nextSize")}
              <ChevronRight aria-hidden size={15} />
            </Button>
          )}
          {step === 2 && draft && (
            <Button
              disabled={!!problem}
              onClick={() => {
                onAdd(draft);
                close();
              }}
            >
              {tr("wsheet.add")}
            </Button>
          )}
          {step === 0 && (
            <Button variant="ghost" onClick={close}>
              {tr("wsheet.cancel")}
            </Button>
          )}
        </>
      }
    >
      {body}
      {step > 0 && problem && (
        <p role="alert" className="mt-3 text-xs text-status-error">
          {problem}
        </p>
      )}
    </ItemSheet>
  );
}
