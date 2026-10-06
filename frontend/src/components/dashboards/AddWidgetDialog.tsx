"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Gauge, LineChart, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { WIDGET_LABEL, WIDTHS } from "@/components/dashboards/DashboardGrid";
import { cn } from "@/lib/cn";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type Widget = components["schemas"]["Widget"];
type WidgetType = Widget["type"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const TYPES: { type: WidgetType; icon: typeof Activity; metric?: boolean; floatOnly?: boolean; range?: boolean; actuators?: boolean; w: number; h: number }[] = [
  { type: "value_card", icon: Activity, metric: true, w: 3, h: 2 },
  { type: "trend_chart", icon: LineChart, metric: true, floatOnly: true, w: 8, h: 4 },
  { type: "gauge", icon: Gauge, metric: true, floatOnly: true, range: true, w: 3, h: 3 },
  { type: "device_status", icon: Cpu, w: 3, h: 2 },
  { type: "actuator_control", icon: ToggleRight, actuators: true, w: 4, h: 3 },
];

/** Add a widget (demo G): type cards, then device, metric (from the
 * device's template), gauge range and width. Placed at the bottom. */
export function AddWidgetDialog({
  open,
  onClose,
  dashboardName,
  devices,
  templates,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  dashboardName: string;
  devices: DeviceResponse[];
  templates: CatalogEntryResponse[];
  onAdd: (widget: Omit<Widget, "x" | "y">) => void;
}) {
  const [type, setType] = useState<WidgetType>("value_card");
  const [deviceId, setDeviceId] = useState("");
  const [metric, setMetric] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("100");
  const [width, setWidth] = useState(3);
  const spec = TYPES.find((t) => t.type === type)!;
  const tplOf = (d?: DeviceResponse) => templates.find((t) => t.id === d?.catalog_entry_id);

  const eligibleDevices = useMemo(
    () => devices.filter((d) => !spec.actuators || (tplOf(d)?.actuators.length ?? 0) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices, templates, spec.actuators],
  );
  const device = eligibleDevices.find((d) => d.id === deviceId) ?? eligibleDevices[0];
  const metrics = (tplOf(device)?.metrics ?? []).filter((m) => !spec.floatOnly || m.data_type !== "bool");

  // Keep the picks valid as the type or device changes.
  useEffect(() => {
    if (device && device.id !== deviceId) setDeviceId(device.id);
  }, [device, deviceId]);
  useEffect(() => {
    if (!spec.metric) return;
    if (!metrics.some((m) => wireId(m) === metric)) {
      const first = metrics[0];
      setMetric(first ? wireId(first) : "");
      if (spec.range && first) {
        setMin(String(first.min ?? 0));
        setMax(String(first.max ?? 100));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, device?.id, metrics.length]);

  const problem = !device
    ? spec.actuators
      ? "No device here has actuators."
      : "Add a device first."
    : spec.metric && !metric
      ? `${device.name} publishes no ${spec.floatOnly ? "numeric " : ""}metric to show.`
      : spec.range && (min === "" || max === "" || Number.isNaN(Number(min)) || Number.isNaN(Number(max)))
        ? "Min and max must be numbers."
        : spec.range && Number(max) <= Number(min)
          ? "Max must be above min."
          : null;

  function add() {
    if (problem || !device) return;
    onAdd({
      id: crypto.randomUUID(),
      type,
      w: width,
      h: spec.h,
      device_id: device.id,
      metric: spec.metric ? metric : null,
      min: spec.range ? Number(min) : null,
      max: spec.range ? Number(max) : null,
    });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add a widget to ${dashboardName}`}
      wide
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!!problem}>
            Add widget
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Widget type" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            role="radio"
            aria-checked={type === t.type}
            onClick={() => {
              setType(t.type);
              setWidth(t.w);
            }}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-md border border-border bg-canvas px-2 py-3 text-[13px] text-ink hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]",
              type === t.type && "border-accent bg-accent-muted",
            )}
          >
            <t.icon aria-hidden size={16} />
            {WIDGET_LABEL[t.type]}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Device">
          <Select value={device?.id ?? ""} onChange={(e) => setDeviceId(e.target.value)} disabled={eligibleDevices.length === 0}>
            {eligibleDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {spec.metric && (
          <Field label="Metric">
            <Select
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value);
                const m = metrics.find((x) => wireId(x) === e.target.value);
                if (spec.range && m) {
                  setMin(String(m.min ?? 0));
                  setMax(String(m.max ?? 100));
                }
              }}
              disabled={metrics.length === 0}
            >
              {metrics.map((m) => (
                <option key={wireId(m)} value={wireId(m)}>
                  {m.name} ({wireId(m)})
                </option>
              ))}
            </Select>
          </Field>
        )}
        {spec.range && (
          <>
            <Field label="Min">
              <Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </Field>
            <Field label="Max">
              <Input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Width">
          <Select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {WIDTHS.map((n) => (
              <option key={n} value={n}>
                {n} of 12 columns
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-[12.5px] text-status-error">
          {problem}
        </p>
      )}
    </Dialog>
  );
}
