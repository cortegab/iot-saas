"use client";

import { useState, type ReactNode } from "react";
import { Cpu, Plug, Plus, ToggleRight, Usb } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LineRow, Lines } from "@/components/ui/LineRow";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { Table } from "@/components/ui/Table";
import { SECTION_LABEL } from "@/components/rules/editor/fields";
import { pinName, pinsFor, resolveModel } from "@/lib/hardware/board-pins";
import { CHIPS, type SketchBoard } from "@/lib/firmware-sketch";
import { driversFor, findDriver, hasCapability, runsOn, type DriverCatalog, type DriverParamSpec } from "@/lib/hardware/driver-catalog";
import { chipForName, detectChip, webSerialSupported } from "@/lib/hardware/flasher";
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
  onRenameTarget,
  targetError,
  onKeepReading,
}: {
  hardware: HardwareDraft | null;
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] };
  catalog: { data?: DriverCatalog; loading: boolean; error: boolean };
  readOnly: boolean;
  onChange: (next: HardwareDraft | null) => void;
  /** Error/warning props and blur handler for a field path. */
  field: (path: string) => { error?: string; warning?: string; onBlur: () => void };
  /** Renames the metric or actuator a reading feeds, right on the part card
   * (a template's editor; a device's own wiring can't rename them). */
  onRenameTarget?: (kind: Kind, uid: string, name: string) => void;
  /** The key problem (clash, reserved, invalid) of the row a reading feeds. */
  targetError?: (kind: Kind, uid: string) => string | undefined;
  /** Keep or drop one of a part's readings (a template's editor: it makes or
   * removes the metric). Parts with many readings get a checkbox for each. */
  onKeepReading?: (bindingUid: string, channel: string, keep: boolean) => void;
}) {
  // What the last board change moved, for the author to rewire.
  const [moved, setMoved] = useState<{ board: string; pins: MovedPin[]; unsupported: string[] } | null>(null);
  // The part whose item sheet is open (DESIGN.md §7: one at a time).
  const [openPart, setOpenPart] = useState<string | null>(null);
  // "Detect my board": the chip the plugged-in board reported, and the attempt.
  const [detected, setDetected] = useState<{ name: string; chip: SketchBoard | null } | null>(null);
  const [detectState, setDetect] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
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
    if (!spec) return;
    // A new part opens its sheet straight away.
    const b = blankBinding(spec, h, fw);
    commit({ ...h, [kind]: [...h[kind], b] });
    setOpenPart(b.uid);
  };
  const busPins = model ? pinsFor(model, "bus") : [];
  const i2cOthers = new Map(usedPins(h).filter((u) => !u.path.startsWith("hardware.i2c")).map((u) => [u.pin, u.owner]));
  const guide = wiringGuide(h, rows, fw);
  // One metric is fed, and one actuator driven, by one channel: the pickers
  // offer only what's still free.
  const taken = { inputs: takenTargets(h, "inputs"), outputs: takenTargets(h, "outputs") };
  const fedUids = new Set(h.inputs.flatMap((b) => Object.values(b.channels)).filter(Boolean));
  const drivenUids = new Set(h.outputs.flatMap((b) => Object.values(b.channels)).filter(Boolean));
  const wiredMetrics = fedUids.size;
  const wiredActuators = drivenUids.size;
  // "What you'll see": the metrics and actuators the parts produce, by name.
  const seen = rows.metrics.filter((r) => fedUids.has(r.uid)).map((r) => r.name || r.key || "Unnamed");
  const switched = rows.actuators.filter((r) => drivenUids.has(r.uid)).map((r) => r.name || r.key || "Unnamed");
  const boardField = field("hardware.board");

  // A new board keeps every pin that still fits and moves the rest (moveToBoard).
  const changeBoard = (id: string) => {
    const next = moveToBoard(h, id, fw);
    setMoved({ board: fw.models.find((m) => m.id === id)?.label ?? id, pins: next.moved, unsupported: next.unsupported });
    commit(next.hardware);
  };
  // The board list, grouped by chip (DESIGN.md §8); narrowed to one chip once detected.
  const groups = CHIPS.map((chip) => ({ chip, name: fw.manifest.boards[chip]?.chip ?? chip, models: fw.models.filter((m) => m.chip === chip) })).filter(
    (g) => g.models.length > 0 && (!detected?.chip || g.chip === detected.chip),
  );

  async function detect() {
    setDetect({ busy: false, error: null });
    // The port picker needs this click's user gesture: ask before any await.
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      return; // picker closed
    }
    setDetect({ busy: true, error: null });
    try {
      const name = await detectChip(port);
      const chip = chipForName(fw!.manifest, name);
      setDetected({ name, chip });
      const first = chip && model?.chip !== chip ? fw!.models.find((m) => m.chip === chip) : undefined;
      if (first) changeBoard(first.id);
      setDetect({ busy: false, error: null });
    } catch (err) {
      setDetect({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3.5 @[640px]:grid-cols-2">
        <Field
          label="Board"
          error={boardField.error ?? detectState.error ?? undefined}
          hint={`${model?.description ? `${model.description} ` : ""}Pins are checked for this board. Firmware ${fw.version}.`}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {/* A saved chip id ("esp32") shows as its model until the board is picked again. */}
              <Select value={model?.id ?? h.board} disabled={readOnly} onChange={(e) => changeBoard(e.target.value)}>
                {!model && <option value={h.board}>{h.board} (not in this firmware)</option>}
                {model && !groups.some((g) => g.chip === model.chip) && <option value={model.id}>{model.label}</option>}
                {groups.map((g) => (
                  <optgroup key={g.chip} label={g.name}>
                    {g.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {hasCapability(m, "ble") ? "" : " · no phone setup"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {!readOnly && webSerialSupported() && (
                <Button variant="secondary" className="shrink-0" disabled={detectState.busy} onClick={() => void detect()}>
                  <Usb aria-hidden size={14} />
                  {detectState.busy ? "Detecting…" : "Detect my board"}
                </Button>
              )}
            </div>
            {model && (
              <div className="flex flex-wrap items-center gap-1.5">
                {hasCapability(model, "ble") ? <Tag size="sm">Phone setup</Tag> : <Tag size="sm">Wi-Fi typed in</Tag>}
                {hasCapability(model, "rgb_led") && <Tag size="sm">RGB LED</Tag>}
              </div>
            )}
            {detected && (
              <p className="text-[13px] text-ink-muted">
                {detected.chip ? `Detected an ${detected.name}. Boards with the same chip look alike, so pick your model.` : `This board is an ${detected.name}, which firmware ${fw.version} doesn't support yet.`}{" "}
                <Button variant="link" className="text-[13px]" onClick={() => setDetected(null)}>
                  Show all boards
                </Button>
              </p>
            )}
          </div>
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
          {h[kind].length > 0 && (
            <Lines label={kind === "inputs" ? "Inputs" : "Outputs"}>
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
                  open={openPart === b.uid}
                  onOpen={() => setOpenPart(b.uid)}
                  onClose={() => setOpenPart(null)}
                  onChange={(next) => setBinding(kind, i, next)}
                  onRemove={() => commit({ ...h, [kind]: h[kind].filter((x) => x.uid !== b.uid) })}
                  onRenameTarget={onRenameTarget}
                  targetError={targetError}
                  onKeepReading={onKeepReading}
                />
              ))}
            </Lines>
          )}
          {!readOnly && (
            <Button variant="secondary" className="self-start" onClick={() => add(kind)}>
              <Plus aria-hidden size={14} />
              {kind === "inputs" ? "Add input" : "Add output"}
            </Button>
          )}
        </div>
      ))}

      {(seen.length > 0 || switched.length > 0) && (
        <p className="rounded-lg bg-canvas px-3.5 py-2.5 text-[13px] text-ink-muted">
          <b className="font-medium text-ink">What you&apos;ll see: </b>
          {seen.length > 0 ? seen.join(", ") : "no readings yet"}
          {switched.length > 0 && (
            <>
              {" · "}
              <b className="font-medium text-ink">and switch: </b>
              {switched.join(", ")}
            </>
          )}
        </p>
      )}

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
  open,
  onOpen,
  onClose,
  onChange,
  onRemove,
  onRenameTarget,
  targetError,
  onKeepReading,
}: {
  kind: Kind;
  index: number;
  /** Its item sheet is open. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
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
  onRenameTarget?: (kind: Kind, uid: string, name: string) => void;
  targetError?: (kind: Kind, uid: string) => string | undefined;
  onKeepReading?: (bindingUid: string, channel: string, keep: boolean) => void;
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

  // Its problems, counted on its line (DESIGN.md §5 Line row).
  const paths = [p + "driver", ...pins.map((r) => `${p}pins.${r.role}`), ...params.map((x) => `${p}params.${x.key}`), ...channels.map((c) => `${p}channels.${c.key}`)];
  const issues = paths.filter((path) => field(path).error).length;
  // The one line: pins · what its readings feed.
  const fed = channels.map((c) => targets.find((t) => t.uid === binding.channels[c.key])).filter((t): t is KeyedRow => !!t);
  const summary = [
    i2c ? "I2C" : Object.values(binding.pins).filter((n): n is number => n != null).map((n) => pinName(model, n)).join(", ") || "no pin",
    fed.length ? fed.map((t) => t.name || t.key).join(", ") : kind === "inputs" ? "feeds nothing" : "drives nothing",
  ].join(" · ");
  // A part with many readings asks which to keep (DESIGN.md §8).
  const choosing = !!onKeepReading && kind === "inputs" && channels.length > 2 && !readOnly;

  return (
    <>
      <LineRow
        icon={kind === "inputs" ? <Plug size={16} /> : <ToggleRight size={16} />}
        title={spec?.label ?? binding.driver}
        sub={`${noun} ${index + 1} · ${summary}`}
        issues={issues}
        selected={open}
        onOpen={onOpen}
      />
      <ItemSheet
        open={open}
        onClose={onClose}
        title={spec?.label ?? binding.driver}
        sub={`${noun} ${index + 1} · ${kind === "inputs" ? "its readings feed the metrics named here" : "it drives the actuator named here"}`}
        footer={
          <>
            {!readOnly && (
              <Button
                variant="link-danger"
                className="mr-auto text-[13px]"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
              >
                Remove part
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
      <div className="flex flex-col gap-4">
        {spec?.description && <p className="text-[13px] text-ink-muted">{spec.description}</p>}
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
                const linked = targets.find((t) => t.uid === current);
                const keyProblem = linked && targetError?.(kind, linked.uid);
                const kept = !choosing || current !== "";
                return (
                  <Field key={ch.key} inline label={ch.label} error={error ?? keyProblem} warning={warning}>
                    <div className="flex flex-col gap-1.5">
                      {choosing && (
                        <label className="flex items-center gap-2 text-[13px] text-ink">
                          <input
                            type="checkbox"
                            aria-label={`Keep ${ch.label}`}
                            checked={kept}
                            onChange={(e) => onKeepReading!(binding.uid, ch.key, e.target.checked)}
                            className="accent-[var(--color-accent)]"
                          />
                          {kept ? "Keep" : "Not kept: no metric"}
                        </label>
                      )}
                      {kept && (
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
                      )}
                      {/* Named right here (DESIGN.md §8): what the dashboards call it. */}
                      {linked && onRenameTarget && !readOnly && (
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`Name of what ${ch.label} ${kind === "inputs" ? "feeds" : "drives"}`}
                            value={linked.name}
                            placeholder="Name"
                            onChange={(e) => onRenameTarget(kind, linked.uid, e.target.value)}
                          />
                          <span className="shrink-0 font-mono text-xs text-ink-muted">{linked.key || "key"}</span>
                        </div>
                      )}
                    </div>
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
      </ItemSheet>
    </>
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
