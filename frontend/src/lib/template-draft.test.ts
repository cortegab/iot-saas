import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoardModel, DriverSpec } from "@/lib/hardware/driver-catalog";
import { blankBinding, blankHardware, type HardwareCatalog } from "@/lib/hardware/hardware-draft";
import {
  blankActuator,
  blankMetric,
  blankTemplate,
  brokenUsages,
  draftToRequest,
  keepReading,
  matchingTemplate,
  reconcileParts,
  renamed,
  templateSectionOrder,
  templateToDraft,
  unfedRows,
  validateTemplate,
  type TemplateDraft,
} from "@/lib/template-draft";

const entry = {
  id: "t1",
  name: "Climate",
  status: "active",
  runs_on: "own_code",
  is_legacy: false,
  device_count: 2,
  created_at: "",
  updated_at: "",
  metrics: [
    { name: "Temperature", key: "temperature", unit: "°C", data_type: "float", decimals: 1, min: -20, max: 80, publish: "periodic", publish_interval_seconds: 30, publish_deadband: null },
  ],
  actuators: [{ name: "Fan", key: "fan1", value_type: "bool", allowed_values: null, on_value: 1, off_value: 0 }],
} as never;

const ctx = { otherNames: [] as string[] };

describe("template draft", () => {
  it("keeps following the name while the key is auto (the old freeze bug)", () => {
    let m = blankMetric();
    for (const name of ["T", "Te", "Temp", "Temperature"]) m = renamed(m, name);
    expect(m.key).toBe("temperature");
    const edited = { ...m, key: "temp_c", keyAuto: false };
    expect(renamed(edited, "Temperature 2").key).toBe("temp_c");
  });

  it("round-trips a saved entry and keeps untouched scalar types", () => {
    const d = templateToDraft(entry);
    const req = draftToRequest(d);
    expect(req.metrics[0]).toMatchObject({ key: "temperature", decimals: 1, min: -20, max: 80, publish_interval_seconds: 30 });
    expect(req.actuators[0]).toMatchObject({ on_value: 1, off_value: 0 });
    d.actuators[0].on = "ON";
    expect(draftToRequest(d).actuators[0].on_value).toBe("ON");
  });

  it("validates names, keys, ranges and actuator values", () => {
    const d: TemplateDraft = blankTemplate("own_code");
    d.metrics[0] = { ...d.metrics[0], name: "", key: "a/b", min: "5", max: "5" };
    d.actuators = [{ ...blankActuator(), name: "Fan", key: "fan", on: "1", off: "1" }];
    const { errors } = validateTemplate(d, ctx);
    expect(errors["general.name"]).toMatch(/name/);
    expect(errors["metrics.0.name"]).toBeDefined();
    expect(errors["metrics.0.key"]).toMatch(/MQTT topic segment/);
    expect(errors["metrics.0.max"]).toMatch(/greater than min/);
    expect(errors["actuators.0.off"]).toMatch(/different/);
  });

  it("refuses reserved and duplicate keys, grandfathers a saved key", () => {
    const d = templateToDraft(entry);
    d.metrics.push({ ...blankMetric(), name: "S", key: "status" }, { ...blankMetric(), name: "T2", key: "Temperature" });
    const { errors } = validateTemplate(d, ctx);
    expect(errors["metrics.1.key"]).toMatch(/reserved/);
    expect(errors["metrics.2.key"]).toMatch(/Already used/);
    const legacy = { ...d, metrics: [{ ...d.metrics[0], key: "room temp", origKey: "room temp" }] };
    expect(validateTemplate(legacy, ctx).errors["metrics.0.key"]).toBeUndefined();
  });

  it("warns on renaming a used key and lists broken usages", () => {
    const original = templateToDraft(entry);
    const d = structuredClone(original);
    d.metrics[0].key = "temp_c";
    d.actuators = [];
    const usage = { metrics: { temperature: { rules: 2, widgets: 1 } }, actuators: { fan1: { rules: 1, widgets: 0 } } };
    expect(validateTemplate(d, { ...ctx, usage }).warnings["metrics.0.key"]).toMatch(/disconnects 2 rules and 1 dashboard widget/);
    expect(brokenUsages(d, original, usage)).toEqual([
      "Renaming “temperature” → “temp_c” disconnects 2 rules and 1 dashboard widget.",
      "Removing actuator “fan1” disconnects 1 rule.",
    ]);
  });

  it("rejects a name another template already has", () => {
    const d = { ...blankTemplate(), name: "climate" };
    expect(validateTemplate(d, { otherNames: ["Climate"] }).errors["general.name"]).toMatch(/already/);
  });
});

describe("reconcileParts", () => {
  const read = <T,>(file: string) => JSON.parse(readFileSync(new URL(`../../../firmware/${file}`, import.meta.url), "utf8")) as T;
  const CATALOG: HardwareCatalog = { drivers: read<{ drivers: DriverSpec[] }>("drivers.json").drivers, models: read<{ models: BoardModel[] }>("boards.json").models };
  const spec = (id: string) => CATALOG.drivers.find((d) => d.id === id)!;
  const empty = (): TemplateDraft => ({ ...blankTemplate(), name: "Bench", metrics: [], hardware: blankHardware() });
  /** The draft after adding a part of `driver` (as the Wiring section's Add does). */
  const add = (d: TemplateDraft, driver: string) => {
    const s = spec(driver);
    const kind = s.kind === "input" ? "inputs" : "outputs";
    const h = d.hardware!;
    return reconcileParts(d, { ...h, [kind]: [...h[kind], blankBinding(s, h, CATALOG)] }, CATALOG);
  };

  it("a DHT22 brings temperature °C and humidity %, linked", () => {
    const d = add(empty(), "dht22");
    expect(d.metrics.map((m) => [m.name, m.key, m.unit])).toEqual([
      ["Temperature", "temperature", "°C"],
      ["Humidity", "humidity", "%"],
    ]);
    const ch = d.hardware!.inputs[0].channels;
    expect(ch).toEqual({ temperature: d.metrics[0].uid, humidity: d.metrics[1].uid });
    expect(validateTemplate(d, { otherNames: [], catalog: CATALOG }).errors).toEqual({});
  });

  it("a relay brings an on/off actuator named after it; a servo a numeric one", () => {
    const d = add(add(empty(), "relay"), "servo");
    expect(d.actuators.map((a) => [a.name, a.key, a.value_type])).toEqual([
      ["Relay", "relay", "bool"],
      ["Servo", "servo", "float"],
    ]);
    expect(validateTemplate(d, { otherNames: [], catalog: CATALOG }).errors).toEqual({});
  });

  it("an MPU-6050 brings only its common readings; the raw axes start not kept", () => {
    const d = add(empty(), "mpu6050");
    expect(d.metrics.map((m) => m.key)).toEqual(["tilt_x", "tilt_y", "vibration_rms"]);
    expect(d.hardware!.inputs[0].channels.accel_x).toBe("");
  });

  /** The draft after a part's driver changes (Replace part), as the card's picker does. */
  const replace = (d: TemplateDraft, kind: "inputs" | "outputs", i: number, driver: string) => {
    const h = d.hardware!;
    const old = h[kind][i];
    const without = { ...h, [kind]: h[kind].filter((x) => x.uid !== old.uid) };
    const fresh = { ...blankBinding(spec(driver), without, CATALOG), uid: old.uid };
    return reconcileParts(d, { ...h, [kind]: h[kind].map((x, j) => (j === i ? fresh : x)) }, CATALOG);
  };

  it("replacing a part keeps the metric a reading of the same unit fed (DHT22 → DS18B20)", () => {
    const d = add(empty(), "dht22");
    // A saved template: its metrics are records now, not proposals.
    const saved = { ...d, metrics: d.metrics.map((m) => ({ ...m, origKey: m.key })), hardware: { ...d.hardware!, inputs: d.hardware!.inputs.map((b) => ({ ...b, proposed: undefined })) } };
    const temperature = saved.metrics[0];
    const r = replace(saved, "inputs", 0, "ds18b20");
    expect(r.hardware!.inputs[0].channels.temp_1).toBe(temperature.uid);
    // Humidity has no °C/% match on a DS18B20: kept, fed by nothing.
    expect(r.metrics.map((m) => m.key)).toEqual(expect.arrayContaining(["temperature", "humidity"]));
    expect(Object.values(r.hardware!.inputs[0].channels)).not.toContain(saved.metrics[1].uid);
  });

  it("replacing a part drops the untouched proposals nothing carries, and keeps an actuator by its key (relay → PWM)", () => {
    const d = replace(add(empty(), "dht22"), "inputs", 0, "ds18b20");
    expect(d.metrics.map((m) => m.key)).not.toContain("humidity");
    const relay = add(empty(), "relay");
    const fan = relay.actuators[0];
    const pwm = replace(relay, "outputs", 0, "pwm");
    expect(pwm.hardware!.outputs[0].channels.value).toBe(fan.uid);
  });

  it("keeping a reading makes its metric; dropping an untouched one removes it again", () => {
    const d = add(empty(), "mpu6050");
    const part = d.hardware!.inputs[0].uid;
    const kept = keepReading(d, part, "accel_x", true, CATALOG);
    const row = kept.metrics.find((m) => m.key === "accel_x")!;
    expect(kept.hardware!.inputs[0].channels.accel_x).toBe(row.uid);

    const dropped = keepReading(kept, part, "accel_x", false, CATALOG);
    expect(dropped.metrics.map((m) => m.key)).not.toContain("accel_x");
    expect(dropped.hardware!.inputs[0].channels.accel_x).toBe("");
  });

  it("dropping a reading whose metric was edited keeps the metric, unlinked", () => {
    const d = add(empty(), "dht22");
    const part = d.hardware!.inputs[0].uid;
    const edited = { ...d, metrics: d.metrics.map((m, i) => (i === 0 ? { ...m, name: "Air" } : m)) };
    const dropped = keepReading(edited, part, "temperature", false, CATALOG);
    expect(dropped.metrics.map((m) => m.name)).toContain("Air");
    expect(dropped.hardware!.inputs[0].channels.temperature).toBe("");
  });

  it("a second part of the same kind gets suffixed keys", () => {
    const d = add(add(empty(), "dht22"), "dht22");
    expect(d.metrics.map((m) => m.key)).toEqual(["temperature", "humidity", "temperature_2", "humidity_2"]);
    expect(d.metrics[2].name).toBe("Temperature 2");
  });

  it("links a free row with the same key and type instead of adding one", () => {
    const own = { ...blankMetric(), name: "Air temp", key: "temperature", keyAuto: false };
    const d = add({ ...empty(), metrics: [own] }, "dht22");
    expect(d.metrics.map((m) => m.key)).toEqual(["temperature", "humidity"]);
    expect(d.hardware!.inputs[0].channels.temperature).toBe(own.uid);
  });

  it("removing a part takes its untouched rows, and keeps edited ones", () => {
    const d = add(empty(), "dht22");
    const edited = { ...d, metrics: d.metrics.map((m, i) => (i === 0 ? { ...m, name: "Air" } : m)) };
    const gone = reconcileParts(edited, { ...edited.hardware!, inputs: [] }, CATALOG);
    expect(gone.metrics.map((m) => m.name)).toEqual(["Air"]);
  });

  it("changing a part's driver swaps its untouched rows", () => {
    const d = add(empty(), "dht22");
    const b = d.hardware!.inputs[0];
    const swapped = { ...blankBinding(spec("hcsr04"), { ...d.hardware!, inputs: [] }, CATALOG), uid: b.uid };
    const next = reconcileParts(d, { ...d.hardware!, inputs: [swapped] }, CATALOG);
    expect(next.metrics.map((m) => [m.key, m.unit])).toEqual([["distance_cm", "cm"]]);
  });

  it("leaves existing wiring alone", () => {
    const d = add(empty(), "dht22");
    const again = reconcileParts(d, d.hardware, CATALOG);
    expect(again.metrics).toEqual(d.metrics);
  });
});

describe("templateSectionOrder", () => {
  it("puts the wiring after General on our firmware, and has none for own code", () => {
    expect(templateSectionOrder({ runsOn: "generic_firmware" })).toEqual(["general", "hardware", "metrics", "actuators"]);
    expect(templateSectionOrder({ runsOn: "own_code" })).toEqual(["general", "metrics", "actuators"]);
  });

  it("never sends wiring for own code, and says how it runs", () => {
    const own = { ...blankTemplate("own_code"), name: "Gateway" };
    expect(blankTemplate().metrics).toEqual([]);
    expect(own.metrics).toHaveLength(1);
    expect(draftToRequest(own)).toMatchObject({ runs_on: "own_code", hardware: null });
  });
});

describe("unfedRows", () => {
  const read = <T,>(file: string) => JSON.parse(readFileSync(new URL(`../../../firmware/${file}`, import.meta.url), "utf8")) as T;
  const CATALOG: HardwareCatalog = { drivers: read<{ drivers: DriverSpec[] }>("drivers.json").drivers, models: read<{ models: BoardModel[] }>("boards.json").models };
  const spec = (id: string) => CATALOG.drivers.find((d) => d.id === id)!;

  it("names what a removed part stopped feeding, and nothing a new part feeds", () => {
    const base: TemplateDraft = { ...blankTemplate(), name: "Bench", hardware: blankHardware() };
    const h = base.hardware!;
    const d = reconcileParts(base, { ...h, inputs: [blankBinding(spec("dht22"), h, CATALOG)] }, CATALOG);
    // Edited, so removing the part keeps the metrics (only untouched proposals go).
    const edited = { ...d, metrics: d.metrics.map((m) => ({ ...m, name: `${m.name}!` })) };
    const removed = reconcileParts(edited, { ...edited.hardware!, inputs: [] }, CATALOG);
    expect(unfedRows(edited, removed).map((x) => x.row.key)).toEqual(["temperature", "humidity"]);
    expect(unfedRows(base, d)).toEqual([]);
  });
});

describe("matchingTemplate", () => {
  const saved = (over: object) => ({ ...(entry as object), ...over }) as never;

  it("finds an enabled template with the same keys, how it runs and its parts", () => {
    const d = templateToDraft(entry);
    expect(matchingTemplate(d, [saved({ id: "a" })])).toMatchObject({ id: "a" });
    expect(matchingTemplate(d, [saved({ id: "b", status: "disabled" })])).toBeUndefined();
    expect(matchingTemplate(d, [saved({ id: "c", runs_on: "generic_firmware" })])).toBeUndefined();
    expect(matchingTemplate({ ...d, metrics: d.metrics.slice(1) }, [saved({ id: "d" })])).toBeUndefined();
  });
});
