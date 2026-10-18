/**
 * Device-template editor model (DESIGN.md §8): draft shape, conversion to
 * and from the API, and validation. Pure — no React — so it's unit-tested.
 */

import { findDriver, type DriverChannelSpec, type DriverSpec } from "@/lib/hardware/driver-catalog";
import {
  takenTargets,
  hardwareToDraft,
  hardwareToRequest,
  validateHardware,
  type HardwareCatalog,
  type HardwareDraft,
  type KeyedRow,
} from "@/lib/hardware/hardware-draft";
import { slugify } from "@/lib/slug";
import { UNIT_CATEGORIES } from "@/lib/units";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];
type Scalar = boolean | number | string;

/** Mirrors backend catalog/service.py KEY_PATTERN: one MQTT topic segment. */
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Reserved device-contract segments (CLAUDE.md §4). */
export const RESERVED_METRIC_KEYS = ["status", "config"];

export interface MetricDraft {
  uid: string;
  name: string;
  key: string;
  /** Key still follows the name (until the author edits it). */
  keyAuto: boolean;
  /** The key as saved — for rename warnings and grandfathering. */
  origKey: string | null;
  data_type: "float" | "bool";
  unit: string | null;
  decimals: string;
  min: string;
  max: string;
  publish: "periodic" | "on_change" | "streaming";
  interval: string;
  deadband: string;
}

export interface ActuatorDraft {
  uid: string;
  name: string;
  key: string;
  keyAuto: boolean;
  origKey: string | null;
  value_type: "bool" | "float" | "string";
  on: string;
  off: string;
  allowed: string;
  /** Saved values, so an untouched field keeps its exact wire type. */
  saved: { on: Scalar | null; off: Scalar | null; allowed: Scalar[] | null };
}

export interface TemplateDraft {
  name: string;
  enabled: boolean;
  metrics: MetricDraft[];
  actuators: ActuatorDraft[];
  /** Wiring for the generic firmware; null = none (devices use the sketch). */
  hardware: HardwareDraft | null;
}

export type TemplateSectionId = "general" | "hardware" | "metrics" | "actuators";

/** The editor's sections, in order: one list, so every way into the editor
 * agrees. Onboarding from the hardware puts the wiring right after General,
 * since parts bring the metrics and actuators; editing a template keeps it last. */
export function templateSectionOrder({ onboarding }: { onboarding: boolean }): TemplateSectionId[] {
  return onboarding ? ["general", "hardware", "metrics", "actuators"] : ["general", "metrics", "actuators", "hardware"];
}

/** The metric and actuator rows wiring can point at. */
export function keyedRows(d: Pick<TemplateDraft, "metrics" | "actuators">): { metrics: KeyedRow[]; actuators: KeyedRow[] } {
  return {
    metrics: d.metrics.map((m) => ({ uid: m.uid, key: m.key.trim(), name: m.name.trim(), type: m.data_type })),
    actuators: d.actuators.map((a) => ({ uid: a.uid, key: a.key.trim(), name: a.name.trim(), type: a.value_type })),
  };
}

let seq = 0;
const uid = () => `r${++seq}`;
const str = (v: unknown) => (v == null ? "" : String(v));

export function blankMetric(): MetricDraft {
  return {
    uid: uid(),
    name: "",
    key: "",
    keyAuto: true,
    origKey: null,
    data_type: "float",
    unit: null,
    decimals: "1",
    min: "",
    max: "",
    publish: "periodic",
    interval: "30",
    deadband: "",
  };
}

export function blankActuator(): ActuatorDraft {
  return {
    uid: uid(),
    name: "",
    key: "",
    keyAuto: true,
    origKey: null,
    value_type: "bool",
    on: "true",
    off: "false",
    allowed: "",
    saved: { on: null, off: null, allowed: null },
  };
}

export function blankTemplate(): TemplateDraft {
  return { name: "", enabled: true, metrics: [blankMetric()], actuators: [], hardware: null };
}

/** Saved entry → draft. `duplicate` drops the saved keys' identity. */
export function templateToDraft(e: CatalogEntryResponse, { duplicate = false } = {}): TemplateDraft {
  const rows = templateRows(e, duplicate);
  return { ...rows, hardware: hardwareToDraft(e.hardware, keyedRows(rows)) };
}

function templateRows(e: CatalogEntryResponse, duplicate: boolean): Omit<TemplateDraft, "hardware"> {
  return {
    name: duplicate ? `${e.name} (copy)` : e.name,
    enabled: duplicate ? true : e.status === "active",
    metrics: e.metrics.map((m) => ({
      uid: uid(),
      name: m.name,
      key: m.key ?? "",
      keyAuto: false,
      origKey: duplicate ? null : (m.key ?? null),
      data_type: m.data_type ?? "float",
      unit: m.unit ?? null,
      decimals: str(m.decimals),
      min: str(m.min),
      max: str(m.max),
      publish: m.publish ?? "periodic",
      interval: str(m.publish_interval_seconds),
      deadband: str(m.publish_deadband),
    })),
    actuators: e.actuators.map((a) => ({
      uid: uid(),
      name: a.name,
      key: a.key ?? "",
      keyAuto: false,
      origKey: duplicate ? null : (a.key ?? null),
      value_type: a.value_type ?? "bool",
      on: str(a.on_value),
      off: str(a.off_value),
      allowed: (a.allowed_values ?? []).map(String).join(", "),
      saved: { on: a.on_value ?? null, off: a.off_value ?? null, allowed: a.allowed_values ?? null },
    })),
  };
}

/** Name edit: the key follows while it's auto. */
export function renamed<T extends { name: string; key: string; keyAuto: boolean }>(row: T, name: string): T {
  return { ...row, name, key: row.keyAuto ? slugify(name) : row.key };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));
/** Keep a saved scalar's type when its text is unchanged; else send the text. */
const scalar = (text: string, saved: Scalar | null): Scalar | null => {
  if (text.trim() === "") return null;
  return saved != null && String(saved) === text ? saved : text;
};

/** `drivers` types edited wiring params; without it they're sent as saved. */
export function draftToRequest(
  d: TemplateDraft,
  drivers?: DriverSpec[],
): {
  name: string;
  status: "active" | "disabled";
  metrics: CatalogMetric[];
  actuators: CatalogActuator[];
  hardware: HardwareConfig | null;
} {
  return {
    name: d.name.trim(),
    status: d.enabled ? "active" : "disabled",
    hardware: hardwareToRequest(d.hardware, keyedRows(d), drivers),
    metrics: d.metrics.map((m) => ({
      name: m.name.trim(),
      key: m.key.trim() || null,
      unit: m.data_type === "bool" ? null : m.unit,
      data_type: m.data_type,
      decimals: m.data_type === "bool" ? 0 : num(m.decimals),
      min: m.data_type === "bool" ? 0 : num(m.min),
      max: m.data_type === "bool" ? 1 : num(m.max),
      publish: m.publish,
      publish_interval_seconds: m.publish === "on_change" ? null : num(m.interval),
      publish_deadband: m.publish === "on_change" ? num(m.deadband) : null,
    })),
    actuators: d.actuators.map((a) => {
      const allowedText = a.allowed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const savedAllowed = a.saved.allowed;
      const allowed =
        allowedText.length === 0
          ? null
          : savedAllowed && savedAllowed.map(String).join(", ") === allowedText.join(", ")
            ? savedAllowed
            : allowedText;
      return {
        name: a.name.trim(),
        key: a.key.trim() || null,
        value_type: a.value_type,
        allowed_values: a.value_type === "string" ? allowed : null,
        on_value: a.value_type === "bool" ? scalar(a.on, a.saved.on) : null,
        off_value: a.value_type === "bool" ? scalar(a.off, a.saved.off) : null,
      };
    }),
  };
}

export interface KeyUsage {
  rules: number;
  widgets: number;
}

export function usageText(u: KeyUsage | undefined): string {
  if (!u || (u.rules === 0 && u.widgets === 0)) return "";
  const parts: string[] = [];
  if (u.rules) parts.push(`${u.rules} rule${u.rules === 1 ? "" : "s"}`);
  if (u.widgets) parts.push(`${u.widgets} dashboard widget${u.widgets === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** Errors (block save) and warnings (explain a risk), keyed by field path. */
export function validateTemplate(
  d: TemplateDraft,
  ctx: {
    otherNames: string[];
    usage?: { metrics: Record<string, KeyUsage>; actuators: Record<string, KeyUsage> };
    /** The firmware's drivers and boards; without it only the wiring's mapping is checked. */
    catalog?: HardwareCatalog;
  },
): { errors: Record<string, string>; warnings: Record<string, string> } {
  const hardware = validateHardware(d.hardware, keyedRows(d), ctx.catalog);
  const errors: Record<string, string> = { ...hardware.errors };
  const warnings: Record<string, string> = { ...hardware.warnings };
  const name = d.name.trim();
  if (!name) errors["general.name"] = "Give the template a name.";
  else if (ctx.otherNames.some((n) => n.trim().toLowerCase() === name.toLowerCase()))
    errors["general.name"] = "Another template already has this name.";

  const checkKeys = (kind: "metrics" | "actuators") => {
    const seen = new Map<string, number>();
    d[kind].forEach((row, i) => {
      const p = `${kind}.${i}.`;
      if (!row.name.trim()) errors[p + "name"] = "Enter a name.";
      const key = row.key.trim();
      if (!key) errors[p + "key"] = "Enter a key. It's filled from the name until you edit it.";
      else if (key !== row.origKey && !KEY_PATTERN.test(key))
        errors[p + "key"] = "Use letters, digits, - and _ only (no spaces, / + # or a leading $). The key becomes an MQTT topic segment.";
      else if (kind === "metrics" && RESERVED_METRIC_KEYS.includes(key.toLowerCase()))
        errors[p + "key"] = `“${key}” is reserved by the device contract (…/${key.toLowerCase()} topic).`;
      else if (seen.has(key.toLowerCase())) {
        const other = d[kind][seen.get(key.toLowerCase())!];
        errors[p + "key"] = `Already used by ${kind === "metrics" ? "metric" : "actuator"} “${other.name || other.key}”.`;
      }
      if (key && !seen.has(key.toLowerCase())) seen.set(key.toLowerCase(), i);
      if (row.origKey && key !== row.origKey && !errors[p + "key"]) {
        const u = usageText(ctx.usage?.[kind][row.origKey]);
        if (u) warnings[p + "key"] = `Renaming from “${row.origKey}” disconnects ${u}. History stays under the old key.`;
      }
    });
  };
  checkKeys("metrics");
  checkKeys("actuators");

  d.metrics.forEach((m, i) => {
    const p = `metrics.${i}.`;
    if (m.data_type === "float") {
      if (m.decimals !== "" && !/^(10|[0-9])$/.test(m.decimals.trim())) errors[p + "decimals"] = "Enter a whole number from 0 to 10.";
      const lo = num(m.min);
      const hi = num(m.max);
      if (m.min.trim() !== "" && Number.isNaN(lo)) errors[p + "min"] = "Enter a number.";
      if (m.max.trim() !== "" && Number.isNaN(hi)) errors[p + "max"] = "Enter a number.";
      else if (lo != null && hi != null && !Number.isNaN(lo) && hi <= lo) errors[p + "max"] = `Must be greater than min (${m.min}).`;
    }
    if (m.publish !== "on_change" && m.interval.trim() !== "" && !(Number(m.interval) >= 1))
      errors[p + "interval"] = "At least 1 second.";
    if (m.publish === "on_change" && m.deadband.trim() !== "" && !(Number(m.deadband) >= 0))
      errors[p + "deadband"] = "Enter 0 or more.";
  });

  d.actuators.forEach((a, i) => {
    const p = `actuators.${i}.`;
    if (a.value_type === "bool") {
      if (!a.on.trim()) errors[p + "on"] = "Enter the value sent for On.";
      if (!a.off.trim()) errors[p + "off"] = "Enter the value sent for Off.";
      else if (a.on.trim() === a.off.trim()) errors[p + "off"] = "On and Off must send different values.";
    }
    if (a.value_type === "string" && !a.allowed.trim()) errors[p + "allowed"] = "List the values it accepts, separated by commas.";
  });

  return { errors, warnings };
}

/** Saved keys that this draft renames or removes and that something uses. */
export function brokenUsages(
  d: TemplateDraft,
  original: TemplateDraft | null,
  usage: { metrics: Record<string, KeyUsage>; actuators: Record<string, KeyUsage> } | undefined,
): string[] {
  if (!original || !usage) return [];
  const out: string[] = [];
  for (const kind of ["metrics", "actuators"] as const) {
    for (const row of original[kind]) {
      if (!row.origKey) continue;
      const u = usageText(usage[kind][row.origKey]);
      if (!u) continue;
      const now = d[kind].find((r) => r.uid === row.uid);
      if (!now) out.push(`Removing ${kind === "metrics" ? "metric" : "actuator"} “${row.origKey}” disconnects ${u}.`);
      else if (now.key.trim() !== row.origKey) out.push(`Renaming “${row.origKey}” → “${now.key.trim()}” disconnects ${u}.`);
    }
  }
  return out;
}

const UNIT_SYMBOLS = new Set(UNIT_CATEGORIES.flatMap((c) => c.units.map((u) => u.symbol)));

/** A part's channel as the row it proposes: "Probe 1 (°C)" → name "Probe 1",
 * unit °C; a part's lone `value` channel takes the part's name ("Relay"). */
function proposal(spec: DriverSpec, ch: DriverChannelSpec): { name: string; key: string; unit: string | null } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(ch.label);
  const lone = ch.key === "value" && spec.channels.length === 1;
  // "Relay / on-off output" → "Relay".
  const part = spec.label.split(" / ")[0].trim();
  const name = lone ? part : (m ? m[1] : ch.label).trim();
  const unit = m && UNIT_SYMBOLS.has(m[2].trim()) ? m[2].trim() : null;
  return { name, key: lone ? slugify(part) : ch.key, unit };
}

/** `base`, else `base_2`, `base_3`… — free of `used` and the reserved keys. */
function freeKey(base: string, used: Set<string>): string {
  let key = base;
  for (let n = 2; used.has(key) || RESERVED_METRIC_KEYS.includes(key); n++) key = `${base}_${n}`;
  return key;
}

const snapshot = (row: MetricDraft | ActuatorDraft) => JSON.stringify(row);

/**
 * Keeps the template's rows in step with its parts (the user's choice: adding
 * a part creates what it reads or drives). For a part that's new, or whose
 * driver changed, each channel links to a free row with the same key and type,
 * else to a new row it proposes. A part that goes, or changes driver, takes its
 * proposed rows with it — unless they were edited since, or something else
 * links them. Everything else passes through as `next` has it.
 */
export function reconcileParts(prev: TemplateDraft, next: HardwareDraft | null, catalog: HardwareCatalog | undefined): TemplateDraft {
  if (!catalog) return { ...prev, hardware: next };
  // Wiring cleared: as if every part went.
  if (!next) return prev.hardware ? { ...reconcileParts(prev, { ...prev.hardware, inputs: [], outputs: [] }, catalog), hardware: null } : prev;
  const before = new Map([...(prev.hardware?.inputs ?? []), ...(prev.hardware?.outputs ?? [])].map((b) => [b.uid, b]));
  let metrics = [...prev.metrics];
  let actuators = [...prev.actuators];

  // Parts gone, or on another driver: their untouched proposals go.
  const nextByUid = new Map([...next.inputs, ...next.outputs].map((b) => [b.uid, b]));
  const dropping = new Set<string>();
  for (const old of before.values()) {
    const now = nextByUid.get(old.uid);
    if (now && now.driver === old.driver) continue;
    for (const [rowUid, snap] of Object.entries(old.proposed ?? {})) {
      const row = metrics.find((r) => r.uid === rowUid) ?? actuators.find((r) => r.uid === rowUid);
      if (row && snapshot(row) === snap) dropping.add(rowUid);
    }
  }
  const stillLinked = new Set(
    [...next.inputs, ...next.outputs].flatMap((b) => (before.get(b.uid)?.driver === b.driver ? Object.values(b.channels) : [])),
  );
  for (const u of stillLinked) dropping.delete(u);
  metrics = metrics.filter((r) => !dropping.has(r.uid));
  actuators = actuators.filter((r) => !dropping.has(r.uid));

  // Parts new, or on another driver: link or propose a row per channel.
  const propose = (kind: "inputs" | "outputs") =>
    next[kind].map((b) => {
      const old = before.get(b.uid);
      const keep = (c: Record<string, string>) => Object.fromEntries(Object.entries(c).map(([ch, ref]) => [ch, dropping.has(ref) ? "" : ref]));
      if (old && old.driver === b.driver) return { ...b, channels: keep(b.channels) };
      const spec = findDriver(catalog.drivers, b.driver);
      if (!spec) return { ...b, proposed: undefined };
      const channels: Record<string, string> = {};
      const proposed: Record<string, string> = {};
      for (const ch of spec.channels) {
        const p = proposal(spec, ch);
        const taken = takenTargets({ ...next, [kind]: next[kind].filter((x) => x.uid !== b.uid) }, kind);
        if (kind === "inputs") {
          const type = ch.data_type ?? "float";
          const free = metrics.find((r) => r.key.trim() === p.key && r.data_type === type && !taken.has(r.uid) && !Object.values(channels).includes(r.uid));
          if (free) {
            channels[ch.key] = free.uid;
            continue;
          }
          const key = freeKey(p.key, new Set(metrics.map((r) => r.key.trim())));
          const row: MetricDraft = { ...blankMetric(), name: key === p.key ? p.name : `${p.name} ${key.slice(p.key.length + 1)}`, key, keyAuto: false, data_type: type, unit: p.unit };
          metrics.push(row);
          channels[ch.key] = row.uid;
          proposed[row.uid] = snapshot(row);
        } else {
          const type = ch.value_type ?? "bool";
          const free = actuators.find((r) => r.key.trim() === p.key && r.value_type === type && !taken.has(r.uid) && !Object.values(channels).includes(r.uid));
          if (free) {
            channels[ch.key] = free.uid;
            continue;
          }
          const key = freeKey(p.key, new Set(actuators.map((r) => r.key.trim())));
          const base: ActuatorDraft = { ...blankActuator(), name: key === p.key ? p.name : `${p.name} ${key.slice(p.key.length + 1)}`, key, keyAuto: false, value_type: type };
          const row = type === "bool" ? base : { ...base, on: "", off: "" };
          actuators.push(row);
          channels[ch.key] = row.uid;
          proposed[row.uid] = snapshot(row);
        }
      }
      return { ...b, channels, proposed };
    });
  const inputs = propose("inputs");
  const outputs = propose("outputs");
  return { ...prev, metrics, actuators, hardware: { ...next, inputs, outputs } };
}
