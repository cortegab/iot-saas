/**
 * Starter kits (ease-of-use plan B3): common builds for Add device → Something
 * new on our firmware. A kit is only a list of parts from the firmware's own
 * driver catalog plus friendlier names for what they bring; applying one does
 * exactly what Add part does (blankBinding, then reconcileParts), so pins are
 * picked and checked the same way and everything stays editable.
 */
import { findDriver } from "@/lib/hardware/driver-catalog";
import { blankBinding, blankHardware, syncI2c, type HardwareCatalog, type HardwareDraft } from "@/lib/hardware/hardware-draft";
import { reconcileParts, renamed, type TemplateDraft } from "@/lib/template-draft";

export interface KitPart {
  driver: string;
  /** Driver channel → the name its metric or actuator gets. */
  names?: Record<string, string>;
}

export interface StarterKit {
  id: string;
  title: string;
  description: string;
  parts: KitPart[];
  /** The rule recipe this build is usually for, offered after it's made. */
  recipe: string;
}

export const STARTER_KITS: StarterKit[] = [
  {
    id: "greenhouse",
    title: "Greenhouse climate",
    description: "Temperature and humidity (DHT22), and a fan on a relay.",
    parts: [
      { driver: "dht22", names: { temperature: "Air temperature", humidity: "Humidity" } },
      { driver: "relay", names: { value: "Fan" } },
    ],
    recipe: "too-hot",
  },
  {
    id: "tank",
    title: "Tank level",
    description: "Distance to the water from the top (HC-SR04), and a pump on a relay.",
    parts: [
      { driver: "hcsr04", names: { distance_cm: "Distance to water" } },
      { driver: "relay", names: { value: "Pump" } },
    ],
    recipe: "reading-high",
  },
  {
    id: "door",
    title: "Door contact",
    description: "A door or reed switch on a digital input.",
    parts: [{ driver: "digital_in", names: { value: "Door open" } }],
    recipe: "door-open",
  },
  {
    id: "cold-room",
    title: "Cold room",
    description: "A waterproof temperature probe (DS18B20); up to four on one pin.",
    parts: [{ driver: "ds18b20", names: { temp_1: "Cold room temperature" } }],
    recipe: "reading-high",
  },
];

/** The kits this firmware can build on this board (every driver present). */
export function kitsFor(catalog: HardwareCatalog | undefined): StarterKit[] {
  if (!catalog) return [];
  return STARTER_KITS.filter((k) => k.parts.every((p) => findDriver(catalog.drivers, p.driver)));
}

/** The draft with the kit's parts added to its wiring (replacing any parts
 * already there), and their readings and outputs named. */
export function applyKit(draft: TemplateDraft, kit: StarterKit, catalog: HardwareCatalog): TemplateDraft {
  // Start from no parts: the parts already there go, with every reading and
  // output they fed (a kit replaces a kit; a renamed row isn't "untouched").
  const before = draft.hardware ?? blankHardware();
  const fed = new Set([...before.inputs, ...before.outputs].flatMap((x) => Object.values(x.channels)).filter(Boolean));
  let d: TemplateDraft = {
    ...draft,
    metrics: draft.metrics.filter((m) => !fed.has(m.uid)),
    actuators: draft.actuators.filter((a) => !fed.has(a.uid)),
    hardware: { ...before, inputs: [], outputs: [] },
  };
  let h: HardwareDraft = d.hardware!;
  const added: { uid: string; part: KitPart }[] = [];
  for (const part of kit.parts) {
    const spec = findDriver(catalog.drivers, part.driver);
    if (!spec) continue;
    const kind = spec.kind === "input" ? "inputs" : "outputs";
    const b = blankBinding(spec, h, catalog);
    h = { ...h, [kind]: [...h[kind], b] };
    added.push({ uid: b.uid, part });
  }
  d = reconcileParts(d, syncI2c(h, catalog), catalog);

  // Name what each part brought, through `renamed` so auto keys follow.
  const bindings = [...(d.hardware?.inputs ?? []), ...(d.hardware?.outputs ?? [])];
  const names = new Map<string, string>();
  for (const { uid, part } of added) {
    const b = bindings.find((x) => x.uid === uid);
    for (const [channel, name] of Object.entries(part.names ?? {})) {
      const row = b?.channels[channel];
      if (row) names.set(row, name);
    }
  }
  return {
    ...d,
    metrics: d.metrics.map((m) => (names.has(m.uid) ? renamed(m, names.get(m.uid)!) : m)),
    actuators: d.actuators.map((a) => (names.has(a.uid) ? renamed(a, names.get(a.uid)!) : a)),
  };
}
