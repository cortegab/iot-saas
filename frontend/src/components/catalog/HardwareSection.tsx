"use client";

import { useState, type ReactNode } from "react";
import { Cpu, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { Table } from "@/components/ui/Table";
import { SECTION_LABEL } from "@/components/rules/editor/fields";
import { pinName, pinsFor, resolveModel } from "@/lib/hardware/board-pins";
import { driversFor, findDriver, runsOn, type DriverCatalog, type DriverParamSpec } from "@/lib/hardware/driver-catalog";
import {
  blankBinding,
  blankHardware,
  moveToBoard,
  syncI2c,
  takenTargets,
  usedPins,
  wiringGuide,
  type BindingDraft,
  type HardwareDraft,
  type KeyedRow,
  type MovedPin,
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
  // What the last board change moved, for the author to rewire.
  const [moved, setMoved] = useState<{ board: string; pins: MovedPin[]; unsupported: string[] } | null>(null);
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
  // Every change goes through syncI2c, so the I2C bus row comes and goes with
  // the I2C drivers.
  const commit = (next: HardwareDraft) => onChange(syncI2c(next, fw));
  const setBinding = (kind: Kind, i: number, b: BindingDraft) => commit({ ...h, [kind]: h[kind].map((x, j) => (j === i ? b : x)) });
  const firstOf = (kind: Kind) => driversFor(fw.drivers, model).find((d) => d.kind === (kind === "inputs" ? "input" : "output"));
  const add = (kind: Kind) => {
    const spec = firstOf(kind);
    if (spec) commit({ ...h, [kind]: [...h[kind], blankBinding(spec, h, fw)] });
  };
  const busPins = model ? pinsFor(model, "bus") : [];
  const i2cOthers = new Map(usedPins(h).filter((u) => !u.path.startsWith("hardware.i2c")).map((u) => [u.pin, u.owner]));
  const guide = wiringGuide(h, rows, fw);
  // One metric is fed, and one actuator driven, by one channel: the pickers
  // offer only what's still free.
  const taken = { inputs: takenTargets(h, "inputs"), outputs: takenTargets(h, "outputs") };
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
          {/* A new board keeps every pin that still fits and moves the rest (moveToBoard). */}
          <Select
            value={model?.id ?? h.board}
            disabled={readOnly}
            onChange={(e) => {
              const next = moveToBoard(h, e.target.value, fw);
              setMoved({ board: fw.models.find((m) => m.id === e.target.value)?.label ?? e.target.value, pins: next.moved, unsupported: next.unsupported });
              commit(next.hardware);
            }}
          >
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

      {/* One summary of a board change: pins that moved, and parts it can't run. */}
      {moved && (moved.pins.length > 0 || moved.unsupported.length > 0) && (
        <Callout tone="warning" title={`Changed for the ${moved.board}`}>
          <ul className="list-disc pl-4">
            {moved.pins.map((m) => (
              <li key={`${m.owner}-${m.from}`}>
                {m.owner}: GPIO {m.from} → {m.to == null ? "no free pin left, pick one" : pinName(model, m.to)}
              </li>
            ))}
            {moved.unsupported.map((label) => (
              <li key={label}>{label}: not in this board&apos;s firmware. Pick another part, or remove it.</li>
            ))}
          </ul>
          {moved.pins.length > 0 && "Rewire those as the wiring guide below shows."}
        </Callout>
      )}

      {h.i2c && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">I2C bus</h3>
          <p className="text-[13px] text-ink-muted">Every I2C part below shares these two pins; each needs its own address.</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">
            {(["sda", "scl"] as const).map((line) => (
              <Field key={line} label={line.toUpperCase()} error={field(`hardware.i2c.${line}`).error}>
                <Select
                  value={h.i2c![line]}
                  disabled={readOnly}
                  onChange={(e) => onChange({ ...h, i2c: { ...h.i2c!, [line]: Number(e.target.value) } })}
                >
                  {(busPins.includes(h.i2c![line]) ? busPins : [h.i2c![line], ...busPins]).map((n) => (
                    <option key={n} value={n}>
                      {pinName(model, n)}
                      {i2cOthers.has(n) ? ` · used by ${i2cOthers.get(n)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
        </div>
      )}

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
              taken={taken[kind]}
              readOnly={readOnly}
              field={field}
              onChange={(next) => setBinding(kind, i, next)}
              onRemove={() => commit({ ...h, [kind]: h[kind].filter((x) => x.uid !== b.uid) })}
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
  taken,
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
  /** Rows some channel already feeds or drives (takenTargets). */
  taken: Map<string, string>;
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
  // Only what this board's firmware carries, plus the current driver if it
  // isn't (so the card still shows it, with validateHardware's error).
  const choices = drivers.filter((d) => d.kind === (kind === "inputs" ? "input" : "output") && (runsOn(d, model) || d.id === binding.driver));
  // What else holds each pin, for the picker's labels.
  const others = new Map(usedPins(hardware).filter((u) => !u.path.startsWith(p)).map((u) => [u.pin, u.owner]));

  const pickDriver = (id: string) => {
    const next = findDriver(drivers, id);
    if (!next) return;
    // Start fresh on the new driver, with pins chosen around everyone else's.
    const without = { ...hardware, [kind]: hardware[kind].filter((x) => x.uid !== binding.uid) };
    onChange({ ...blankBinding(next, without, catalog), uid: binding.uid });
  };

  // The card reads top to bottom: driver, how it connects, its settings, then
  // what each of its readings feeds (or the actuator it drives).
  const pins = spec?.pins ?? [];
  const i2c = spec?.bus === "i2c";
  const params = spec?.params ?? [];
  // An I2C part's address is part of how it connects, not a setting.
  const connectionParams = i2c ? params.filter((x) => x.key === "address") : [];
  const settings = params.filter((x) => !connectionParams.includes(x));
  const channels = spec?.channels ?? [];

  const renderParam = (param: DriverParamSpec) => {
    const path = `${p}params.${param.key}`;
    const value = binding.params[param.key] ?? param.default;
    const setParam = (v: string | boolean) => onChange({ ...binding, params: { ...binding.params, [param.key]: v } });
    if (param.type === "bool") {
      return (
        <SwitchField key={param.key} label={param.label} checked={value === true} disabled={readOnly} onChange={setParam} onLabel="On" offLabel="Off" />
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
      <div className="flex flex-col gap-4">
        <div className="grid gap-3.5 @[640px]:grid-cols-2">
          <Field label="Driver" error={field(p + "driver").error}>
            <Select value={binding.driver} disabled={readOnly} onChange={(e) => pickDriver(e.target.value)}>
              {!spec && <option value={binding.driver}>{binding.driver} (not in this firmware)</option>}
              {choices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {(pins.length > 0 || i2c) && (
          <Block title="Connection">
            {i2c && (
              <p className="text-[13px] text-ink-muted">
                On the I2C bus
                {hardware.i2c && ` (SDA ${pinName(model, hardware.i2c.sda)}, SCL ${pinName(model, hardware.i2c.scl)})`}: no pins of its own.
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">
              {pins.map((role) => {
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
              {connectionParams.map(renderParam)}
            </div>
          </Block>
        )}

        {settings.length > 0 && (
          <Block title="Settings">
            <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">{settings.map(renderParam)}</div>
          </Block>
        )}

        {channels.length > 0 && (
          <Block title={kind === "inputs" ? "Readings" : "Commands"} aside={kind === "inputs" ? "Feeds metric" : "Drives actuator"}>
            <div className="flex flex-col gap-2.5">
              {channels.map((ch) => {
                const path = `${p}channels.${ch.key}`;
                const { error, warning } = field(path);
                const current = binding.channels[ch.key] ?? "";
                // Rows another channel already holds are left out; this
                // picker's own choice always stays.
                const free = targets.filter((t) => t.uid === current || !taken.has(t.uid));
                return (
                  <Field key={ch.key} inline label={ch.label} error={error} warning={warning}>
                    <Select
                      value={current}
                      disabled={readOnly}
                      onChange={(e) => onChange({ ...binding, channels: { ...binding.channels, [ch.key]: e.target.value } })}
                    >
                      <option value="">{kind === "inputs" ? "Not used" : "Pick an actuator"}</option>
                      {current && !targets.some((t) => t.uid === current) && <option value={current}>Missing</option>}
                      {free.map((t) => (
                        <option key={t.uid} value={t.uid}>
                          {t.name || "Unnamed"}
                          {t.key ? ` (${t.key})` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              })}
              {/* Only where it explains an empty picker: this card has a free
                  channel and nothing is left to give it. */}
              {!readOnly && targets.length > 0 && channels.some((ch) => !binding.channels[ch.key]) && targets.every((t) => taken.has(t.uid)) && (
                <p className="text-[13px] text-ink-muted">
                  {kind === "inputs"
                    ? "Every metric is already fed. Add a metric above to map more."
                    : "Every actuator is already driven. Add an actuator above to wire more."}
                </p>
              )}
            </div>
          </Block>
        )}
      </div>
    </fieldset>
  );
}

/** One labelled block of a binding card. `aside` heads the right-hand column
 * of an inline Field list (the readings' "Feeds metric"). */
function Block({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3">
        <h4 className={SECTION_LABEL}>{title}</h4>
        {aside && <span className={SECTION_LABEL}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}
