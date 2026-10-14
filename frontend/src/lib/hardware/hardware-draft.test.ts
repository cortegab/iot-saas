import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoardModel, DriverSpec } from "./driver-catalog";
import type { components } from "@/types/api";
import {
  blankBinding,
  blankHardware,
  hardwareToDraft,
  hardwareToRequest,
  validateHardware,
  wiringGuide,
  type HardwareCatalog,
  type KeyedRow,
} from "./hardware-draft";

// The real catalogs the firmware ships, so a catalog change that breaks the
// editor shows up here.
const read = <T,>(file: string) => JSON.parse(readFileSync(new URL(`../../../../firmware/${file}`, import.meta.url), "utf8")) as T;
const DRIVERS = read<{ drivers: DriverSpec[] }>("drivers.json").drivers;
const MODELS = read<{ models: BoardModel[] }>("boards.json").models;
const CATALOG: HardwareCatalog = { drivers: DRIVERS, models: MODELS };
const spec = (id: string) => DRIVERS.find((d) => d.id === id)!;

const rows: { metrics: KeyedRow[]; actuators: KeyedRow[] } = {
  metrics: [
    { uid: "m1", key: "door", name: "Door", type: "bool" },
    { uid: "m2", key: "level", name: "Level", type: "float" },
  ],
  actuators: [{ uid: "a1", key: "fan1", name: "Fan", type: "bool" }],
};

const SAVED: components["schemas"]["HardwareConfig"] = {
  board: "esp32-devkit-30",
  i2c: null,
  inputs: [
    { driver: "digital_in", pins: { pin: 13 }, params: { pull: "up", invert: true }, channels: { value: "door" } },
    { driver: "analog_in", pins: { pin: 34 }, params: { scale: 2.5 }, channels: { value: "level" } },
  ],
  outputs: [{ driver: "relay", pins: { pin: 23 }, params: { active_low: true }, channels: { value: "fan1" } }],
};

describe("hardwareToDraft / hardwareToRequest", () => {
  it("round-trips a saved config unchanged", () => {
    const draft = hardwareToDraft(SAVED, rows)!;
    expect(draft.inputs[0].channels.value).toBe("m1");
    expect(hardwareToRequest(draft, rows, DRIVERS)).toEqual(SAVED);
  });

  it("follows a key renamed in the same draft", () => {
    const draft = hardwareToDraft(SAVED, rows)!;
    const renamed = { ...rows, metrics: rows.metrics.map((m) => (m.uid === "m1" ? { ...m, key: "front-door" } : m)) };
    expect(hardwareToRequest(draft, renamed, DRIVERS)!.inputs![0].channels).toEqual({ value: "front-door" });
  });

  it("types edited params by the driver spec, and drops blanks", () => {
    const draft = hardwareToDraft(SAVED, rows)!;
    draft.inputs[1].params = { scale: "0.5", samples: "16", offset: "" };
    expect(hardwareToRequest(draft, rows, DRIVERS)!.inputs![1].params).toEqual({ scale: 0.5, samples: 16 });
  });

  it("is null without wiring", () => {
    expect(hardwareToDraft(null, rows)).toBeNull();
    expect(hardwareToRequest(null, rows, DRIVERS)).toBeNull();
  });
});

describe("blankBinding", () => {
  it("starts at the defaults on free pins that suit each role", () => {
    const hw = hardwareToDraft(SAVED, rows)!;
    const b = blankBinding(spec("analog_in"), hw, CATALOG);
    expect(b.params).toEqual({ scale: 1, offset: 0, samples: 8 });
    expect([32, 33, 35, 36, 39]).toContain(b.pins.pin); // ADC1, and 34 is taken
    expect(b.channels).toEqual({ value: "" });
  });

  it("puts a relay on a pin that stays quiet at boot, and inputs off the output pins", () => {
    expect(blankBinding(spec("relay"), blankHardware(), CATALOG).pins.pin).toBe(23);
    expect(blankBinding(spec("digital_in"), blankHardware(), CATALOG).pins.pin).toBe(4);
    expect(blankBinding(spec("relay"), blankHardware("esp32-devkit-38"), CATALOG).pins.pin).toBe(23);
    expect(blankBinding(spec("relay"), blankHardware("esp32c3-supermini"), CATALOG).pins.pin).toBe(3);
  });
});

describe("validateHardware", () => {
  const valid = () => hardwareToDraft(SAVED, rows)!;

  it("passes a valid config", () => {
    expect(validateHardware(valid(), rows, CATALOG)).toEqual({ errors: {}, warnings: {} });
  });

  it("passes the same wiring on the 38-pin DevKit", () => {
    expect(validateHardware({ ...valid(), board: "esp32-devkit-38" }, rows, CATALOG)).toEqual({ errors: {}, warnings: {} });
  });

  it("reads a chip id saved before board models existed as that chip's first model", () => {
    expect(validateHardware({ ...valid(), board: "esp32" }, rows, CATALOG)).toEqual({ errors: {}, warnings: {} });
  });

  it("refuses a board this firmware doesn't know", () => {
    expect(validateHardware({ ...valid(), board: "esp32-s3-devkit" }, rows, CATALOG).errors["hardware.board"]).toMatch(/no “esp32-s3-devkit” board/);
  });

  it("refuses a pin used twice, on the second user", () => {
    const h = valid();
    h.outputs[0].pins.pin = 13;
    expect(validateHardware(h, rows, CATALOG).errors).toEqual({ "hardware.outputs.0.pins.pin": "GPIO 13 is also used by input 1." });
  });

  it("holds analog to ADC1 and outputs off input-only pins", () => {
    const h = valid();
    h.inputs[1].pins.pin = 25;
    h.outputs[0].pins.pin = 35;
    const { errors } = validateHardware(h, rows, CATALOG);
    expect(errors["hardware.inputs.1.pins.pin"]).toMatch(/can't read analog while Wi-Fi is on/);
    expect(errors["hardware.outputs.0.pins.pin"]).toMatch(/input-only/);
  });

  it("checks pins against the chosen board", () => {
    const h = { ...valid(), board: "esp32c3-supermini" };
    expect(validateHardware(h, rows, CATALOG).errors["hardware.inputs.0.pins.pin"]).toBe("GPIO 13 isn't free on the ESP32-C3 Super Mini. Pick another pin.");
  });

  it("refuses a pull resistor on a pin that has none", () => {
    const h = valid();
    h.inputs[0].pins.pin = 35;
    expect(validateHardware(h, rows, CATALOG).errors["hardware.inputs.0.params.pull"]).toMatch(/no internal pull resistor/);
  });

  it("range-checks params", () => {
    const h = valid();
    h.inputs[1].params = { samples: "100", scale: "x" };
    const { errors } = validateHardware(h, rows, CATALOG);
    expect(errors["hardware.inputs.1.params.samples"]).toBe("Enter a number from 1 to 64.");
    expect(errors["hardware.inputs.1.params.scale"]).toBe("Enter a number.");
  });

  it("refuses a metric read twice and an output with no actuator", () => {
    const h = valid();
    h.inputs[1].channels.value = "m1";
    h.outputs[0].channels.value = "";
    const { errors } = validateHardware(h, rows, CATALOG);
    expect(errors["hardware.inputs.1.channels.value"]).toBe("Door is already read by input 1.");
    expect(errors["hardware.outputs.0.channels.value"]).toBe("Pick the actuator it drives.");
  });

  it("flags a key the template no longer has", () => {
    const h = hardwareToDraft(SAVED, { ...rows, metrics: rows.metrics.slice(1) })!;
    expect(validateHardware(h, { ...rows, metrics: rows.metrics.slice(1) }, CATALOG).errors["hardware.inputs.0.channels.value"]).toMatch(
      /“door” isn't a metric of this template any more/,
    );
  });

  it("says so when the row it pointed at was removed in this draft", () => {
    const h = valid();
    const fewer = { ...rows, actuators: [] };
    expect(validateHardware(h, fewer, CATALOG).errors["hardware.outputs.0.channels.value"]).toBe("The actuator it drove was removed. Pick another.");
  });

  it("warns when an input feeds no metric, and not once it does", () => {
    const h = valid();
    h.inputs[0].channels.value = "";
    expect(validateHardware(h, rows, CATALOG)).toEqual({
      errors: {},
      warnings: { "hardware.inputs.0.channels.value": "This input feeds no metric, so nothing from it is published. Pick the metric it reads." },
    });
    h.inputs[0].channels.value = "m1";
    expect(validateHardware(h, rows, CATALOG).warnings).toEqual({});
  });

  it("warns when an on/off reading feeds a number", () => {
    const h = valid();
    h.inputs[0].channels.value = "m2";
    h.inputs[1].channels.value = "";
    expect(validateHardware(h, rows, CATALOG).warnings["hardware.inputs.0.channels.value"]).toMatch(/reads on\/off, but Level is a number/);
  });

  it("refuses a driver this firmware doesn't have", () => {
    const h = valid();
    h.inputs[0].driver = "bme280";
    expect(validateHardware(h, rows, CATALOG).errors["hardware.inputs.0.driver"]).toMatch(/no “bme280” driver/);
  });

  it("has nothing to check without wiring", () => {
    expect(validateHardware(null, rows, CATALOG)).toEqual({ errors: {}, warnings: {} });
    expect(validateHardware(blankHardware(), rows, CATALOG)).toEqual({ errors: {}, warnings: {} });
  });

  it("checks only the mapping without the firmware's catalog", () => {
    const h = valid();
    h.outputs[0].pins.pin = 35; // input-only, but unknowable without the catalog
    expect(validateHardware(h, rows, undefined)).toEqual({ errors: {}, warnings: {} });
  });
});

describe("wiringGuide", () => {
  it("lists pins in order with what they connect to, and each driver's notes once", () => {
    const guide = wiringGuide(hardwareToDraft(SAVED, rows)!, rows, CATALOG);
    expect(guide.pins.map((p) => [p.name, p.to])).toEqual([
      ["GPIO 13", "Digital input (Door)"],
      ["GPIO 23", "Relay / on-off output (Fan)"],
      ["GPIO 34", "Analog input (Level)"],
    ]);
    expect(guide.notes.map((n) => n.driver)).toEqual(["Digital input", "Analog input", "Relay / on-off output"]);
  });

  it("uses the board's printed labels and says how to re-provision it", () => {
    const h = hardwareToDraft(SAVED, rows)!;
    h.inputs[1].pins.pin = 36;
    const guide = wiringGuide(h, rows, CATALOG);
    expect(guide.pins.find((p) => p.pin === 36)?.name).toBe("GPIO 36 (VP)");
    expect(guide.board?.label).toBe("ESP32 DevKit (30-pin)");
    expect(guide.board?.lines.at(-1)).toMatch(/hold a button between GPIO 19 \(D19\) and GND for 5 seconds/);
  });
});
