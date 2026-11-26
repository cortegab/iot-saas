/**
 * A template's wiring for the generic firmware (firmware/), as the editor
 * holds it: draft shape, conversion to and from the API's HardwareConfig,
 * validation and the wiring guide. Pure — no React — so it's unit-tested.
 *
 * Channels point at metric/actuator rows by their editor `uid`, not their key,
 * so renaming a key in the same draft carries its wiring along. A saved key the
 * draft no longer has stays as `key:<key>` and shows as an error.
 */
import { hasInternalPull, pinName, pinProblem, preferredPins, resolveModel } from "@/lib/hardware/board-pins";
import { findDriver, runsOn, type DriverCatalog, type DriverSpec } from "@/lib/hardware/driver-catalog";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type HardwareConfig = components["schemas"]["HardwareConfig"];
type HardwareBinding = components["schemas"]["HardwareBinding"];
type ParamValue = number | boolean | string;
/** What validation and the guide need from the published firmware. */
export type HardwareCatalog = Pick<DriverCatalog, "drivers" | "models">;

export interface BindingDraft {
  uid: string;
  driver: string;
  pins: Record<string, number | null>;
  /** Typed as saved; strings while being edited (converted by the spec on save). */
  params: Record<string, ParamValue>;
  /** Driver channel → metric/actuator row uid ("" = not used). */
  channels: Record<string, string>;
  /** Draft-only, never saved: rows this part created when it was added, by
   * uid, each with its snapshot then, so an untouched one goes when the part
   * does (template-draft.ts's reconcileParts). */
  proposed?: Record<string, string>;
}

export interface HardwareDraft {
  /** A board model id (firmware/boards.json); older configs hold a chip id. */
  board: string;
  i2c: { sda: number; scl: number } | null;
  inputs: BindingDraft[];
  outputs: BindingDraft[];
}

/** The rows a binding can feed or drive. */
export interface KeyedRow {
  uid: string;
  key: string;
  name: string;
  type: string;
}

let seq = 0;
const uid = () => `b${++seq}`;
const MISSING = "key:";

/** The board new wiring starts on. */
export const DEFAULT_BOARD = "esp32-devkit-30";

export function blankHardware(board: string = DEFAULT_BOARD): HardwareDraft {
  return { board, i2c: null, inputs: [], outputs: [] };
}

/** A new binding for `spec`: params at their defaults, each pin on the first
 * free one that suits it, in the board's preferred order. */
export function blankBinding(spec: DriverSpec, hw: HardwareDraft, catalog: HardwareCatalog): BindingDraft {
  const model = resolveModel(catalog.models, hw.board);
  const taken = new Set(usedPins(hw).map((u) => u.pin));
  const pins: Record<string, number | null> = {};
  for (const p of spec.pins) {
    const free = (model ? preferredPins(model, p.needs) : []).find((n) => !taken.has(n)) ?? null;
    pins[p.role] = free;
    if (free != null) taken.add(free);
  }
  return {
    uid: uid(),
    driver: spec.id,
    pins,
    params: Object.fromEntries(spec.params.map((p) => [p.key, p.default])),
    channels: Object.fromEntries(spec.channels.map((c) => [c.key, ""])),
  };
}

/** The metric (inputs) or actuator (outputs) rows already fed or driven, each
 * with the first channel path that holds it. The editor leaves these out of
 * every other channel's picker; a picker always keeps its own choice. */
export function takenTargets(h: HardwareDraft, kind: "inputs" | "outputs"): Map<string, string> {
  const taken = new Map<string, string>();
  h[kind].forEach((b, i) => {
    for (const [ch, ref] of Object.entries(b.channels)) {
      if (ref && !taken.has(ref)) taken.set(ref, `hardware.${kind}.${i}.channels.${ch}`);
    }
  });
  return taken;
}

/** Whether any binding is an I2C driver (they share the bus row's SDA/SCL). */
export function usesI2c(h: HardwareDraft, catalog: HardwareCatalog | undefined): boolean {
  return [...h.inputs, ...h.outputs].some((b) => findDriver(catalog?.drivers, b.driver)?.bus === "i2c");
}

/** Keeps the I2C bus in step with the bindings: the first I2C driver brings
 * the board's default SDA/SCL (or the first two free bus pins if those are
 * taken), and removing the last one clears them. Apply after every change to
 * the bindings or the board. */
export function syncI2c(h: HardwareDraft, catalog: HardwareCatalog | undefined): HardwareDraft {
  if (!usesI2c(h, catalog)) return h.i2c ? { ...h, i2c: null } : h;
  if (h.i2c) return h;
  const model = resolveModel(catalog?.models, h.board);
  if (!model) return h;
  const taken = new Set(usedPins(h).map((u) => u.pin));
  if (model.i2c && !taken.has(model.i2c.sda) && !taken.has(model.i2c.scl)) return { ...h, i2c: { ...model.i2c } };
  const free = preferredPins(model, "bus").filter((p) => !taken.has(p));
  return free.length >= 2 ? { ...h, i2c: { sda: free[0], scl: free[1] } } : h;
}

/** An I2C binding's address: its param, else the driver's default. */
function i2cAddress(b: BindingDraft, spec: DriverSpec): string {
  return String(b.params.address ?? spec.params.find((p) => p.key === "address")?.default ?? "");
}

export function hardwareToDraft(
  h: HardwareConfig | null | undefined,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
): HardwareDraft | null {
  if (!h) return null;
  const byKey = (list: KeyedRow[], key: string) => list.find((r) => r.key === key)?.uid ?? `${MISSING}${key}`;
  const binding = (b: HardwareBinding, list: KeyedRow[]): BindingDraft => ({
    uid: uid(),
    driver: b.driver,
    pins: { ...(b.pins ?? {}) },
    params: { ...(b.params ?? {}) },
    channels: Object.fromEntries(Object.entries(b.channels ?? {}).map(([ch, key]) => [ch, byKey(list, key)])),
  });
  return {
    board: h.board,
    i2c: h.i2c ? { sda: h.i2c.sda, scl: h.i2c.scl } : null,
    inputs: (h.inputs ?? []).map((b) => binding(b, rows.metrics)),
    outputs: (h.outputs ?? []).map((b) => binding(b, rows.actuators)),
  };
}

/** A param as the API takes it: typed by the driver spec when it's known;
 * as saved otherwise. Blank means "use the default", so it's left out. */
function paramValue(value: ParamValue, type: DriverSpec["params"][number]["type"] | undefined): ParamValue | undefined {
  if (typeof value !== "string" || type === undefined || type === "enum") return value;
  if (value.trim() === "") return undefined;
  return type === "int" ? parseInt(value, 10) : Number(value);
}

export function hardwareToRequest(
  h: HardwareDraft | null,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
  drivers: DriverSpec[] | undefined,
): HardwareConfig | null {
  if (!h) return null;
  const keyOf = (list: KeyedRow[], ref: string) =>
    ref.startsWith(MISSING) ? ref.slice(MISSING.length) : (list.find((r) => r.uid === ref)?.key.trim() ?? "");
  const binding = (b: BindingDraft, list: KeyedRow[]) => {
    const spec = findDriver(drivers, b.driver);
    const params: Record<string, ParamValue> = {};
    for (const [key, value] of Object.entries(b.params)) {
      const v = paramValue(value, spec?.params.find((p) => p.key === key)?.type);
      if (v !== undefined) params[key] = v;
    }
    const channels: Record<string, string> = {};
    for (const [ch, ref] of Object.entries(b.channels)) {
      const key = ref ? keyOf(list, ref) : "";
      if (key) channels[ch] = key;
    }
    const pins: Record<string, number> = {};
    for (const [role, pin] of Object.entries(b.pins)) if (pin != null) pins[role] = pin;
    return { driver: b.driver, pins, params, channels };
  };
  return {
    board: h.board,
    i2c: h.i2c,
    inputs: h.inputs.map((b) => binding(b, rows.metrics)),
    outputs: h.outputs.map((b) => binding(b, rows.actuators)),
  };
}

/** Every pin in use, with what uses it. */
export function usedPins(h: HardwareDraft): { pin: number; path: string; owner: string }[] {
  const out: { pin: number; path: string; owner: string }[] = [];
  if (h.i2c) {
    out.push({ pin: h.i2c.sda, path: "hardware.i2c.sda", owner: tr("hwv.busSda") });
    out.push({ pin: h.i2c.scl, path: "hardware.i2c.scl", owner: tr("hwv.busScl") });
  }
  for (const kind of ["inputs", "outputs"] as const) {
    h[kind].forEach((b, i) => {
      for (const [role, pin] of Object.entries(b.pins)) {
        if (pin != null) out.push({ pin, path: `hardware.${kind}.${i}.pins.${role}`, owner: `${kind === "inputs" ? "input" : "output"} ${i + 1}` });
      }
    });
  }
  return out;
}

/** Errors (block save) and warnings (explain a risk), keyed by field path
 * under `hardware.` — the same checks the firmware makes at boot, plus the
 * backend's channel → key check. Without the firmware's catalog only the
 * mapping is checked. */
export function validateHardware(
  h: HardwareDraft | null,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
  catalog: HardwareCatalog | undefined,
): { errors: Record<string, string>; warnings: Record<string, string> } {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  if (!h) return { errors, warnings };
  const drivers = catalog?.drivers;
  const model = resolveModel(catalog?.models, h.board);
  if (catalog && !model) errors["hardware.board"] = tr("hwv.noBoard", { board: h.board });

  // Pins: each suits its role on this board, and none is used twice.
  const seen = new Map<number, string>();
  for (const u of usedPins(h)) {
    const other = seen.get(u.pin);
    if (other) errors[u.path] = tr("hwv.pinShared", { pin: u.pin, other });
    else seen.set(u.pin, u.owner);
  }

  // The I2C bus: there when an I2C driver is, on pins that can carry it.
  if (usesI2c(h, catalog) && !h.i2c) errors["hardware.i2c.sda"] = tr("hwv.pickBus");
  if (h.i2c && model) {
    for (const line of ["sda", "scl"] as const) {
      const path = `hardware.i2c.${line}`;
      const problem = pinProblem(model, "bus", h.i2c[line]);
      if (problem && !errors[path]) errors[path] = problem;
    }
  }
  // Two parts on one bus need different addresses.
  const addresses = new Map<string, string>();
  for (const kind of ["inputs", "outputs"] as const) {
    h[kind].forEach((b, i) => {
      const spec = findDriver(drivers, b.driver);
      if (spec?.bus !== "i2c") return;
      const addr = i2cAddress(b, spec);
      const other = addresses.get(addr);
      if (other)
        errors[`hardware.${kind}.${i}.params.address`] = tr("hwv.addressShared", { address: String(addr), other });
      else addresses.set(addr, `${kind === "inputs" ? "input" : "output"} ${i + 1}`);
    });
  }

  for (const kind of ["inputs", "outputs"] as const) {
    const list = kind === "inputs" ? rows.metrics : rows.actuators;
    const fed = new Map<string, number>();
    h[kind].forEach((b, i) => {
      const p = `hardware.${kind}.${i}.`;
      const spec = findDriver(drivers, b.driver);
      if (drivers && !spec) errors[p + "driver"] = tr("hwv.noDriver", { driver: b.driver });
      else if (spec && spec.kind !== (kind === "inputs" ? "input" : "output"))
        errors[p + "driver"] = tr(kind === "inputs" ? "hwv.notInput" : "hwv.notOutput", { part: spec.label });
      else if (spec && model && !runsOn(spec, model))
        errors[p + "driver"] = tr("hwv.notOnBoard", { board: model.label, part: spec.label });

      for (const role of spec?.pins ?? []) {
        const path = `${p}pins.${role.role}`;
        const pin = b.pins[role.role];
        if (pin == null) errors[path] = tr("hwv.pickPin");
        else if (!errors[path] && model) {
          const problem = pinProblem(model, role.needs, pin);
          if (problem) errors[path] = problem;
        }
      }

      for (const param of spec?.params ?? []) {
        const path = `${p}params.${param.key}`;
        const raw = b.params[param.key];
        if (raw === undefined || raw === "") continue;
        if (param.type === "int" || param.type === "float") {
          const n = Number(raw);
          if (typeof raw === "boolean" || !Number.isFinite(n)) errors[path] = tr("hwv.number");
          else if (param.type === "int" && !Number.isInteger(n)) errors[path] = tr("hwv.whole");
          else if ((param.min != null && n < param.min) || (param.max != null && n > param.max))
            errors[path] = tr("hwv.range", { min: String(param.min), max: String(param.max) });
        } else if (param.type === "enum" && !param.options?.includes(String(raw))) {
          errors[path] = tr("hwv.oneOf", { options: param.options?.join(", ") ?? "" });
        }
      }
      // Pins 34–39 on the ESP32 have no internal pull resistor; the firmware
      // refuses a pull on them (firmware/src/drivers/digital_in.cpp).
      const pullPin = b.pins.pin;
      if (model && b.params.pull !== undefined && b.params.pull !== "none" && pullPin != null && !hasInternalPull(model.chip, pullPin))
        errors[`${p}params.pull`] = tr("hwv.noPull", { pin: pullPin });

      const channels = spec?.channels ?? Object.keys(b.channels).map((key) => ({ key, label: key }) as DriverSpec["channels"][number]);
      if (kind === "outputs" && !b.channels.value) errors[`${p}channels.value`] = tr("hwv.pickActuator");
      // An input that feeds nothing is read and thrown away: the board logs
      // "no input bound" and nothing reaches the platform. A warning, not an
      // error, so half-done wiring can still be saved.
      if (kind === "inputs" && channels.length > 0 && !channels.some((ch) => b.channels[ch.key]))
        warnings[`${p}channels.${channels[0].key}`] = tr("hwv.feedsNothing");
      for (const ch of channels) {
        const path = `${p}channels.${ch.key}`;
        const ref = b.channels[ch.key];
        if (!ref) continue;
        const row = list.find((r) => r.uid === ref);
        if (!row) {
          errors[path] = ref.startsWith(MISSING)
            ? tr(kind === "inputs" ? "hwv.goneMetric" : "hwv.goneActuator", { key: ref.slice(MISSING.length) })
            : tr(kind === "inputs" ? "hwv.removedMetric" : "hwv.removedActuator");
          continue;
        }
        if (fed.has(row.uid)) {
          errors[path] = tr(kind === "inputs" ? "hwv.alreadyRead" : "hwv.alreadyDriven", { name: row.name || row.key, n: fed.get(row.uid)! + 1 });
          continue;
        }
        fed.set(row.uid, i);
        if (kind === "inputs" && ch.data_type === "bool" && row.type !== "bool")
          warnings[path] = tr("hwv.boolToNumber", { name: row.name || row.key });
        if (kind === "outputs" && ch.value_type && row.type !== ch.value_type)
          warnings[path] = tr("hwv.typeMismatch", {
            takes: tr(ch.value_type === "bool" ? "hwv.onOff" : ch.value_type === "float" ? "hwv.aNumber" : "hwv.text"),
            name: row.name || row.key,
            sends: tr(row.type === "bool" ? "hwv.onOff" : row.type === "float" ? "hwv.aNumber" : "hwv.aChoice"),
          });
      }
    });
  }
  return { errors, warnings };
}

export interface WiringGuide {
  /** The board, with its own notes and how to re-provision it. */
  board: { label: string; lines: string[] } | null;
  pins: { pin: number; name: string; to: string; role: string }[];
  notes: { driver: string; lines: string[] }[];
}

/** The pin table and notes a person wires the board from. */
export function wiringGuide(
  h: HardwareDraft,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
  catalog: HardwareCatalog | undefined,
): WiringGuide {
  const model = resolveModel(catalog?.models, h.board);
  const pins: WiringGuide["pins"] = [];
  const notes = new Map<string, string[]>();
  const row = (pin: number, to: string, role: string) => pins.push({ pin, name: pinName(model, pin), to, role });
  if (h.i2c) {
    // Name what's on the bus: "I2C bus (MPU6050 / GY-521 motion)".
    const onBus = [...new Set([...h.inputs, ...h.outputs].map((b) => findDriver(catalog?.drivers, b.driver)).filter((s) => s?.bus === "i2c").map((s) => s!.label))];
    const to = onBus.length ? tr("hwv.busWith", { parts: onBus.join(", ") }) : tr("hwv.busName");
    row(h.i2c.sda, to, "SDA");
    row(h.i2c.scl, to, "SCL");
  }
  for (const kind of ["inputs", "outputs"] as const) {
    const list = kind === "inputs" ? rows.metrics : rows.actuators;
    for (const b of h[kind]) {
      const spec = findDriver(catalog?.drivers, b.driver);
      const fed = Object.values(b.channels)
        .map((ref) => list.find((r) => r.uid === ref))
        .filter((r): r is KeyedRow => !!r)
        .map((r) => r.name || r.key);
      const to = `${spec?.label ?? b.driver}${fed.length ? ` (${fed.join(", ")})` : ""}`;
      for (const [role, pin] of Object.entries(b.pins)) {
        if (pin != null) row(pin, to, spec?.pins.find((p) => p.role === role)?.label ?? role);
      }
      if (spec && spec.wiring.length && !notes.has(spec.label)) notes.set(spec.label, spec.wiring);
    }
  }
  pins.sort((a, b) => a.pin - b.pin);
  const board = model
    ? {
        label: model.label,
        lines: [
          ...(model.notes ?? []),
          tr("hwv.resetWifi", { button: model.reset.label }),
        ],
      }
    : null;
  return { board, pins, notes: [...notes].map(([driver, lines]) => ({ driver, lines })) };
}

export interface MovedPin {
  /** "DHT22 temperature/humidity data", "the I2C bus (SDA)". */
  owner: string;
  from: number;
  /** null: no suitable pin was left on the new board. */
  to: number | null;
}

/** The wiring on another board: every pin that still suits its role there
 * stays, the rest move to the first free suitable pin in the board's
 * preferred order (as blankBinding picks), and the I2C bus takes the new
 * board's default pins. `moved` lists what changed, for the author to rewire,
 * and `unsupported` the parts the new board's firmware doesn't carry (they
 * stay, flagged by validateHardware, for the author to swap or remove). */
export function moveToBoard(
  h: HardwareDraft,
  board: string,
  catalog: HardwareCatalog,
): { hardware: HardwareDraft; moved: MovedPin[]; unsupported: string[] } {
  const model = resolveModel(catalog.models, board);
  if (!model) return { hardware: { ...h, board, i2c: null }, moved: [], unsupported: [] };
  const unsupported = [
    ...new Set(
      [...h.inputs, ...h.outputs]
        .map((b) => findDriver(catalog.drivers, b.driver))
        .filter((s): s is DriverSpec => !!s && !runsOn(s, model))
        .map((s) => s.label),
    ),
  ];
  const moved: MovedPin[] = [];
  const taken = new Set<number>();
  // The bus first: its default pins are the board's, so parts move off them.
  const i2c = usesI2c(h, catalog) && model.i2c ? { ...model.i2c } : null;
  if (i2c) {
    taken.add(i2c.sda);
    taken.add(i2c.scl);
    if (h.i2c && h.i2c.sda !== i2c.sda) moved.push({ owner: "the I2C bus (SDA)", from: h.i2c.sda, to: i2c.sda });
    if (h.i2c && h.i2c.scl !== i2c.scl) moved.push({ owner: "the I2C bus (SCL)", from: h.i2c.scl, to: i2c.scl });
  }
  const roles = (kind: "inputs" | "outputs") =>
    h[kind].flatMap((b, i) => {
      const spec = findDriver(catalog.drivers, b.driver);
      return Object.entries(b.pins).map(([role, pin]) => {
        const p = spec?.pins.find((x) => x.role === role);
        return { kind, i, role, pin, needs: p?.needs ?? ("input" as const), owner: `${spec?.label ?? b.driver} ${(p?.label ?? role).toLowerCase()}` };
      });
    });
  const all = [...roles("inputs"), ...roles("outputs")];
  const placed = new Map<string, number | null>();
  // Keep what still fits, then place the rest.
  for (const r of all) {
    if (r.pin != null && !taken.has(r.pin) && !pinProblem(model, r.needs, r.pin)) {
      placed.set(`${r.kind}.${r.i}.${r.role}`, r.pin);
      taken.add(r.pin);
    }
  }
  for (const r of all) {
    const key = `${r.kind}.${r.i}.${r.role}`;
    if (placed.has(key)) continue;
    const to = preferredPins(model, r.needs).find((n) => !taken.has(n)) ?? null;
    if (to != null) taken.add(to);
    placed.set(key, to);
    if (r.pin != null) moved.push({ owner: r.owner, from: r.pin, to });
  }
  const rebind = (kind: "inputs" | "outputs") =>
    h[kind].map((b, i) => ({ ...b, pins: Object.fromEntries(Object.keys(b.pins).map((role) => [role, placed.get(`${kind}.${i}.${role}`) ?? null])) }));
  return { hardware: { ...h, board: model.id, i2c, inputs: rebind("inputs"), outputs: rebind("outputs") }, moved, unsupported };
}
