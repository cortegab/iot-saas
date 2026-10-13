/**
 * A template's wiring for the generic firmware (firmware/), as the editor
 * holds it: draft shape, conversion to and from the API's HardwareConfig,
 * validation and the wiring guide. Pure — no React — so it's unit-tested.
 *
 * Channels point at metric/actuator rows by their editor `uid`, not their key,
 * so renaming a key in the same draft carries its wiring along. A saved key the
 * draft no longer has stays as `key:<key>` and shows as an error.
 */
import type { SketchBoard } from "@/lib/firmware-sketch";
import { hasInternalPull, pinProblem, preferredPins } from "@/lib/hardware/board-pins";
import { findDriver, type DriverSpec } from "@/lib/hardware/driver-catalog";
import type { components } from "@/types/api";

type HardwareConfig = components["schemas"]["HardwareConfig"];
type HardwareBinding = components["schemas"]["HardwareBinding"];
type ParamValue = number | boolean | string;

export interface BindingDraft {
  uid: string;
  driver: string;
  pins: Record<string, number | null>;
  /** Typed as saved; strings while being edited (converted by the spec on save). */
  params: Record<string, ParamValue>;
  /** Driver channel → metric/actuator row uid ("" = not used). */
  channels: Record<string, string>;
}

export interface HardwareDraft {
  board: SketchBoard;
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

export const BOARD_LABEL: Record<SketchBoard, string> = { esp32: "ESP32 DevKit", esp32c3: "ESP32-C3" };

export function blankHardware(board: SketchBoard = "esp32"): HardwareDraft {
  return { board, i2c: null, inputs: [], outputs: [] };
}

/** A new binding for `spec`: params at their defaults, each pin on the first
 * free one that suits it, in the board's preferred order. */
export function blankBinding(spec: DriverSpec, hw: HardwareDraft): BindingDraft {
  const taken = new Set(usedPins(hw).map((u) => u.pin));
  const pins: Record<string, number | null> = {};
  for (const p of spec.pins) {
    const free = preferredPins(hw.board, p.needs).find((n) => !taken.has(n)) ?? null;
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
    out.push({ pin: h.i2c.sda, path: "hardware.i2c.sda", owner: "the I2C bus (SDA)" });
    out.push({ pin: h.i2c.scl, path: "hardware.i2c.scl", owner: "the I2C bus (SCL)" });
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

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** Errors (block save) and warnings (explain a risk), keyed by field path
 * under `hardware.` — the same checks the firmware makes at boot, plus the
 * backend's channel → key check. Without a driver catalog only the mapping
 * is checked. */
export function validateHardware(
  h: HardwareDraft | null,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
  drivers: DriverSpec[] | undefined,
): { errors: Record<string, string>; warnings: Record<string, string> } {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  if (!h) return { errors, warnings };

  // Pins: each suits its role on this board, and none is used twice.
  const seen = new Map<number, string>();
  for (const u of usedPins(h)) {
    const other = seen.get(u.pin);
    if (other) errors[u.path] = `GPIO ${u.pin} is also used by ${other}.`;
    else seen.set(u.pin, u.owner);
  }

  for (const kind of ["inputs", "outputs"] as const) {
    const list = kind === "inputs" ? rows.metrics : rows.actuators;
    const noun = kind === "inputs" ? "metric" : "actuator";
    const fed = new Map<string, number>();
    h[kind].forEach((b, i) => {
      const p = `hardware.${kind}.${i}.`;
      const spec = findDriver(drivers, b.driver);
      if (drivers && !spec) errors[p + "driver"] = `This firmware has no “${b.driver}” driver. Pick another, or update the firmware.`;
      else if (spec && spec.kind !== (kind === "inputs" ? "input" : "output"))
        errors[p + "driver"] = `${spec.label} is ${article(spec.kind)} ${spec.kind}, not ${kind === "inputs" ? "an input" : "an output"}.`;

      for (const role of spec?.pins ?? []) {
        const path = `${p}pins.${role.role}`;
        const pin = b.pins[role.role];
        if (pin == null) errors[path] = "Pick a pin.";
        else if (!errors[path]) {
          const problem = pinProblem(h.board, role.needs, pin);
          if (problem) errors[path] = problem;
        }
      }

      for (const param of spec?.params ?? []) {
        const path = `${p}params.${param.key}`;
        const raw = b.params[param.key];
        if (raw === undefined || raw === "") continue;
        if (param.type === "int" || param.type === "float") {
          const n = Number(raw);
          if (typeof raw === "boolean" || !Number.isFinite(n)) errors[path] = "Enter a number.";
          else if (param.type === "int" && !Number.isInteger(n)) errors[path] = "Enter a whole number.";
          else if ((param.min != null && n < param.min) || (param.max != null && n > param.max))
            errors[path] = `Enter a number from ${param.min} to ${param.max}.`;
        } else if (param.type === "enum" && !param.options?.includes(String(raw))) {
          errors[path] = `Pick one of ${param.options?.join(", ")}.`;
        }
      }
      // Pins 34–39 on the ESP32 have no internal pull resistor; the firmware
      // refuses a pull on them (firmware/src/drivers/digital_in.cpp).
      const pullPin = b.pins.pin;
      if (b.params.pull !== undefined && b.params.pull !== "none" && pullPin != null && !hasInternalPull(h.board, pullPin))
        errors[`${p}params.pull`] = `GPIO ${pullPin} has no internal pull resistor. Set it to none and fit a 10 kΩ resistor.`;

      const channels = spec?.channels ?? Object.keys(b.channels).map((key) => ({ key, label: key }) as DriverSpec["channels"][number]);
      if (kind === "outputs" && !b.channels.value) errors[`${p}channels.value`] = "Pick the actuator it drives.";
      for (const ch of channels) {
        const path = `${p}channels.${ch.key}`;
        const ref = b.channels[ch.key];
        if (!ref) continue;
        const row = list.find((r) => r.uid === ref);
        if (!row) {
          errors[path] = ref.startsWith(MISSING)
            ? `“${ref.slice(MISSING.length)}” isn't ${article(noun)} ${noun} of this template any more. Pick another.`
            : `The ${noun} it ${kind === "inputs" ? "fed" : "drove"} was removed. Pick another.`;
          continue;
        }
        if (fed.has(row.uid)) {
          errors[path] = `${row.name || row.key} is already ${kind === "inputs" ? "read by" : "driven by"} ${kind.slice(0, -1)} ${fed.get(row.uid)! + 1}.`;
          continue;
        }
        fed.set(row.uid, i);
        if (kind === "inputs" && ch.data_type === "bool" && row.type !== "bool")
          warnings[path] = `This reads on/off, but ${row.name || row.key} is a number. It will read 0 or 1.`;
        if (kind === "outputs" && ch.value_type && row.type !== ch.value_type)
          warnings[path] = `This output takes ${ch.value_type === "bool" ? "on/off" : ch.value_type === "float" ? "a number" : "text"}, but ${row.name || row.key} sends ${row.type === "bool" ? "on/off" : row.type === "float" ? "a number" : "a choice"}.`;
      }
    });
  }
  return { errors, warnings };
}

export interface WiringGuide {
  pins: { pin: number; to: string; role: string }[];
  notes: { driver: string; lines: string[] }[];
}

/** The pin table and per-driver notes a person wires the board from. */
export function wiringGuide(
  h: HardwareDraft,
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] },
  drivers: DriverSpec[] | undefined,
): WiringGuide {
  const pins: WiringGuide["pins"] = [];
  const notes = new Map<string, string[]>();
  if (h.i2c) {
    pins.push({ pin: h.i2c.sda, to: "I2C sensors", role: "SDA" });
    pins.push({ pin: h.i2c.scl, to: "I2C sensors", role: "SCL" });
  }
  for (const kind of ["inputs", "outputs"] as const) {
    const list = kind === "inputs" ? rows.metrics : rows.actuators;
    for (const b of h[kind]) {
      const spec = findDriver(drivers, b.driver);
      const fed = Object.values(b.channels)
        .map((ref) => list.find((r) => r.uid === ref))
        .filter((r): r is KeyedRow => !!r)
        .map((r) => r.name || r.key);
      const to = `${spec?.label ?? b.driver}${fed.length ? ` (${fed.join(", ")})` : ""}`;
      for (const [role, pin] of Object.entries(b.pins)) {
        if (pin == null) continue;
        pins.push({ pin, to, role: spec?.pins.find((p) => p.role === role)?.label ?? role });
      }
      if (spec && spec.wiring.length && !notes.has(spec.label)) notes.set(spec.label, spec.wiring);
    }
  }
  pins.sort((a, b) => a.pin - b.pin);
  return { pins, notes: [...notes].map(([driver, lines]) => ({ driver, lines })) };
}
