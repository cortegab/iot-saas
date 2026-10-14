"use client";

import { Cpu, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { Table } from "@/components/ui/Table";
import { pinName, pinsFor, resolveModel } from "@/lib/hardware/board-pins";
import { findDriver, type DriverCatalog } from "@/lib/hardware/driver-catalog";
import {
  blankBinding,
  blankHardware,
  usedPins,
  wiringGuide,
  type BindingDraft,
  type HardwareDraft,
  type KeyedRow,
} from "@/lib/hardware/hardware-draft";

type Kind = "inputs" | "outputs";

/**
 * A template's Wiring section (DESIGN.md §8): which driver reads each metric
 * and drives each actuator, on which pins, for the generic firmware's
 * one-click install. Optional: without wiring, devices get the sketch.
 * Boards, pins, params and channels come from the published firmware's
 * catalog, so it only offers what that firmware supports.
 */
export function HardwareSection({
  hardware,
  rows,
  catalog,
  readOnly,
  onChange,
  field,
}: {
  hardware: HardwareDraft | null;
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] };
  catalog: { data?: DriverCatalog; loading: boolean; error: boolean };
  readOnly: boolean;
  onChange: (next: HardwareDraft | null) => void;
  /** Error/warning props and blur handler for a field path. */
  field: (path: string) => { error?: string; warning?: string; onBlur: () => void };
}) {
  if (catalog.loading) return <LoadingSkeleton rows={3} rowClassName="h-10" />;

  const fw = catalog.data;
  if (!fw) {
    return hardware ? (
      <Callout tone="warning" title="Couldn't load the driver list">
        This wiring is kept as saved. Publish a firmware release to edit it.
      </Callout>
    ) : (
      <Callout title="No firmware release is published yet">
        Wiring needs one, because it lists the drivers that firmware supports. Until then, devices of this template use the downloadable sketch.
      </Callout>
    );
  }

  if (!hardware) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-5">
        <p className="text-sm text-ink-muted">
          No wiring yet, so devices of this template get a sketch to edit and upload. Set up the wiring once, and every device installs from the
          browser with no code.
        </p>
        {!readOnly && (
          <Button variant="secondary" onClick={() => onChange(blankHardware(fw.models[0]?.id))}>
            <Cpu aria-hidden size={14} />
            Set up wiring
          </Button>
        )}
      </div>
    );
  }

  const h = hardware;
  const model = resolveModel(fw.models, h.board);
  const setBinding = (kind: Kind, i: number, b: BindingDraft) => onChange({ ...h, [kind]: h[kind].map((x, j) => (j === i ? b : x)) });
  const firstOf = (kind: Kind) => fw.drivers.find((d) => d.kind === (kind === "inputs" ? "input" : "output"));
  const add = (kind: Kind) => {
    const spec = firstOf(kind);
    if (spec) onChange({ ...h, [kind]: [...h[kind], blankBinding(spec, h, fw)] });
  };
  const guide = wiringGuide(h, rows, fw);
  const wiredMetrics = new Set(h.inputs.flatMap((b) => Object.values(b.channels)).filter(Boolean)).size;
  const wiredActuators = new Set(h.outputs.flatMap((b) => Object.values(b.channels)).filter(Boolean)).size;
  const boardField = field("hardware.board");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3.5 @[640px]:grid-cols-2">
        <Field
          label="Board"
          error={boardField.error}
          hint={`${model?.description ? `${model.description} ` : ""}Pins are checked for this board. Firmware ${fw.version}.`}
        >
          {/* A saved chip id ("esp32") shows as its model until the board is picked again. */}
          <Select value={model?.id ?? h.board} disabled={readOnly} onChange={(e) => onChange({ ...h, board: e.target.value })}>
            {!model && <option value={h.board}>{h.board} (not in this firmware)</option>}
            {fw.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="self-end pb-2 text-[13px] text-ink-muted">
          {wiredMetrics} of {rows.metrics.length} metrics and {wiredActuators} of {rows.actuators.length} actuators wired. Anything not wired isn&apos;t
          published or switched.
        </p>
      </div>

      {(["inputs", "outputs"] as const).map((kind) => (
        <div key={kind} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{kind === "inputs" ? "Inputs" : "Outputs"}</h3>
          {h[kind].length === 0 && (
            <p className="text-sm text-ink-muted">
              {kind === "inputs" ? "Nothing reads a metric yet." : "Nothing drives an actuator yet."}
            </p>
          )}
          {h[kind].map((b, i) => (
            <BindingCard
              key={b.uid}
              kind={kind}
              index={i}
              binding={b}
              hardware={h}
              catalog={fw}
              targets={kind === "inputs" ? rows.metrics : rows.actuators}
              readOnly={readOnly}
              field={field}
              onChange={(next) => setBinding(kind, i, next)}
              onRemove={() => onChange({ ...h, [kind]: h[kind].filter((x) => x.uid !== b.uid) })}
            />
          ))}
          {!readOnly && (
            <Button variant="link" className="self-start" onClick={() => add(kind)}>
              <Plus aria-hidden size={14} />
              {kind === "inputs" ? "Add input" : "Add output"}
            </Button>
          )}
        </div>
      ))}

      {guide.pins.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Wiring guide</h3>
          <Table
            columns={[
              { header: "Pin", render: (r) => <span className="font-mono">{r.name}</span>, className: "w-36" },
              { header: "Connects to", render: (r) => r.to },
              { header: "As", render: (r) => <span className="text-ink-muted">{r.role}</span> },
            ]}
            rows={guide.pins}
            rowKey={(r) => `${r.pin}-${r.role}-${r.to}`}
          />
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
            {guide.board?.lines.map((line) => (
              <li key={line}>
                <b className="font-medium text-ink">{guide.board!.label}:</b> {line}
              </li>
            ))}
            {guide.notes.map((n) =>
              n.lines.map((line) => (
                <li key={n.driver + line}>
                  <b className="font-medium text-ink">{n.driver}:</b> {line}
                </li>
              )),
            )}
          </ul>
        </div>
      )}

      {!readOnly && (
        <Button variant="link-danger" className="self-start text-[12.5px]" onClick={() => onChange(null)}>
          Remove wiring
        </Button>
      )}
    </div>
  );
}

function BindingCard({
  kind,
  index,
  binding,
  hardware,
  catalog,
  targets,
  readOnly,
  field,
  onChange,
  onRemove,
}: {
  kind: Kind;
  index: number;
  binding: BindingDraft;
  hardware: HardwareDraft;
  catalog: DriverCatalog;
  targets: KeyedRow[];
  readOnly: boolean;
  field: (path: string) => { error?: string; warning?: string; onBlur: () => void };
  onChange: (b: BindingDraft) => void;
  onRemove: () => void;
}) {
  const drivers = catalog.drivers;
  const model = resolveModel(catalog.models, hardware.board);
  const spec = findDriver(drivers, binding.driver);
  const p = `hardware.${kind}.${index}.`;
  const noun = kind === "inputs" ? "Input" : "Output";
  const choices = drivers.filter((d) => d.kind === (kind === "inputs" ? "input" : "output"));
  // What else holds each pin, for the picker's labels.
  const others = new Map(usedPins(hardware).filter((u) => !u.path.startsWith(p)).map((u) => [u.pin, u.owner]));

  const pickDriver = (id: string) => {
    const next = findDriver(drivers, id);
    if (!next) return;
    // Start fresh on the new driver, with pins chosen around everyone else's.
    const without = { ...hardware, [kind]: hardware[kind].filter((x) => x.uid !== binding.uid) };
    onChange({ ...blankBinding(next, without, catalog), uid: binding.uid });
  };

  return (
    <fieldset className="min-w-0 rounded-xl border border-border bg-surface px-3.5 pb-3.5 pt-3">
      <legend className="sr-only">
        {noun} {index + 1}
      </legend>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-ink">
          {noun} {index + 1}
          {spec && <span className="font-normal text-ink-muted"> · {spec.description}</span>}
        </span>
        {!readOnly && (
          <Button variant="link-danger" className="text-[12.5px]" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">
        <Field label="Driver" error={field(p + "driver").error} className="col-span-2">
          <Select value={binding.driver} disabled={readOnly} onChange={(e) => pickDriver(e.target.value)}>
            {!spec && <option value={binding.driver}>{binding.driver} (not in this firmware)</option>}
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        {(spec?.channels ?? []).map((ch) => {
          const path = `${p}channels.${ch.key}`;
          const { error, warning } = field(path);
          return (
            <Field
              key={ch.key}
              label={kind === "inputs" ? (spec!.channels.length > 1 ? `${ch.label} feeds` : "Feeds metric") : "Drives actuator"}
              error={error}
              warning={warning}
              className="col-span-2"
            >
              <Select
                value={binding.channels[ch.key] ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange({ ...binding, channels: { ...binding.channels, [ch.key]: e.target.value } })}
              >
                <option value="">{kind === "inputs" ? "Not used" : "Pick an actuator"}</option>
                {binding.channels[ch.key] && !targets.some((t) => t.uid === binding.channels[ch.key]) && (
                  <option value={binding.channels[ch.key]}>Missing</option>
                )}
                {targets.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.name || "Unnamed"}
                    {t.key ? ` (${t.key})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}

        {(spec?.pins ?? []).map((role) => {
          const path = `${p}pins.${role.role}`;
          const value = binding.pins[role.role];
          const allowed = model ? pinsFor(model, role.needs) : [];
          const options = value != null && !allowed.includes(value) ? [value, ...allowed] : allowed;
          return (
            <Field key={role.role} label={`${role.label} pin`} error={field(path).error}>
              <Select
                value={value ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange({ ...binding, pins: { ...binding.pins, [role.role]: e.target.value === "" ? null : Number(e.target.value) } })}
              >
                {value == null && <option value="">Pick a pin</option>}
                {options.map((n) => (
                  <option key={n} value={n}>
                    {pinName(model, n)}
                    {others.has(n) ? ` · used by ${others.get(n)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}

        {(spec?.params ?? []).map((param) => {
          const path = `${p}params.${param.key}`;
          const value = binding.params[param.key] ?? param.default;
          const setParam = (v: string | boolean) => onChange({ ...binding, params: { ...binding.params, [param.key]: v } });
          if (param.type === "bool") {
            return (
              <SwitchField
                key={param.key}
                label={param.label}
                checked={value === true}
                disabled={readOnly}
                onChange={setParam}
                onLabel="On"
                offLabel="Off"
              />
            );
          }
          const { error, onBlur } = field(path);
          return (
            <Field key={param.key} label={param.label} error={error}>
              {param.type === "enum" ? (
                <Select value={String(value)} disabled={readOnly} onChange={(e) => setParam(e.target.value)}>
                  {param.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  inputMode={param.type === "int" ? "numeric" : "decimal"}
                  value={String(value)}
                  disabled={readOnly}
                  onChange={(e) => setParam(e.target.value)}
                  onBlur={onBlur}
                />
              )}
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}
