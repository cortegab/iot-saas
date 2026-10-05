import { describe, expect, it } from "vitest";
import {
  blankActuator,
  blankMetric,
  blankTemplate,
  brokenUsages,
  draftToRequest,
  renamed,
  templateToDraft,
  validateTemplate,
  type TemplateDraft,
} from "@/lib/template-draft";

const entry = {
  id: "t1",
  name: "Climate",
  status: "active",
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
    const d: TemplateDraft = blankTemplate();
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
