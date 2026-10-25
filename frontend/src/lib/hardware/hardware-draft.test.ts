import { pinsFor } from "./board-pins";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { driversFor, hasCapability, type BoardModel, type DriverSpec } from "./driver-catalog";
import type { components } from "@/types/api";
import {
  blankBinding,
  blankHardware,
  hardwareToDraft,
  hardwareToRequest,
  moveToBoard,
  syncI2c,
  takenTargets,
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

describe("batch 1 drivers", () => {
  it("checks each of the HC-SR04's two pins for its own role", () => {
    const h = blankHardware();
    const b = blankBinding(spec("hcsr04"), h, CATALOG);
    b.channels.distance_cm = "m2";
    b.pins.trig = 34; // input-only: can't trigger
    b.pins.echo = 35; // input-only: fine to listen on
    const { errors } = validateHardware({ ...h, inputs: [b] }, rows, CATALOG);
    expect(errors["hardware.inputs.0.pins.trig"]).toMatch(/input-only/);
    expect(errors["hardware.inputs.0.pins.echo"]).toBeUndefined();
  });

  it("puts the DS18B20 and DHT22 data line on a pin that can drive the bus", () => {
    const h = blankHardware();
    for (const id of ["ds18b20", "dht22"]) {
      const b = blankBinding(spec(id), h, CATALOG);
      expect([34, 35, 36, 39]).not.toContain(b.pins.pin);
    }
  });
});

describe("I2C bus", () => {
  const withMpu = (board = "esp32-devkit-30") => {
    const h = blankHardware(board);
    const mpu = blankBinding(spec("mpu6050"), h, CATALOG);
    mpu.channels.tilt_x = "m2";
    return syncI2c({ ...h, inputs: [mpu] }, CATALOG);
  };

  it("adding an I2C driver brings the board's default bus pins; removing it clears them", () => {
    const h = withMpu();
    expect(h.i2c).toEqual({ sda: 21, scl: 22 });
    expect(withMpu("esp32c3-supermini").i2c).toEqual({ sda: 5, scl: 6 });
    expect(syncI2c({ ...h, inputs: [] }, CATALOG).i2c).toBeNull();
    expect(validateHardware(h, rows, CATALOG).errors).toEqual({});
  });

  it("takes other free pins when the defaults are already wired", () => {
    const h = blankHardware();
    const button = blankBinding(spec("digital_in"), h, CATALOG);
    button.pins.pin = 21;
    button.channels.value = "m1";
    const mpu = blankBinding(spec("mpu6050"), h, CATALOG);
    const synced = syncI2c({ ...h, inputs: [button, mpu] }, CATALOG);
    expect(synced.i2c).not.toBeNull();
    expect([synced.i2c!.sda, synced.i2c!.scl]).not.toContain(21);
  });

  it("refuses two parts on one address", () => {
    const h = withMpu();
    const second = { ...h.inputs[0], uid: "x", channels: { tilt_y: "m1" } };
    const { errors } = validateHardware({ ...h, inputs: [h.inputs[0], second] }, rows, CATALOG);
    expect(errors["hardware.inputs.1.params.address"]).toMatch(/0x68 is also used by input 1/);
    second.params = { ...second.params, address: "0x69" };
    expect(validateHardware({ ...h, inputs: [h.inputs[0], second] }, rows, CATALOG).errors).toEqual({});
  });

  it("refuses SDA on an input-only pin", () => {
    const h = withMpu();
    expect(validateHardware({ ...h, i2c: { sda: 34, scl: 22 } }, rows, CATALOG).errors["hardware.i2c.sda"]).toMatch(/input-only/);
  });

  it("names what's on the bus in the wiring guide", () => {
    const guide = wiringGuide(withMpu(), rows, CATALOG);
    expect(guide.pins.find((p) => p.role === "SDA")).toMatchObject({ pin: 21, to: "I2C bus (MPU6050 / GY-521 motion)" });
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

describe("takenTargets", () => {
  it("is empty with nothing wired", () => {
    expect(takenTargets(blankHardware(), "inputs").size).toBe(0);
  });

  it("maps each fed metric to the first channel holding it, apart from actuators", () => {
    const h = hardwareToDraft(SAVED, rows)!;
    const inputs = takenTargets(h, "inputs");
    expect([...inputs]).toEqual([
      ["m1", "hardware.inputs.0.channels.value"],
      ["m2", "hardware.inputs.1.channels.value"],
    ]);
    expect([...takenTargets(h, "outputs")]).toEqual([["a1", "hardware.outputs.0.channels.value"]]);
  });

  it("counts every channel of a multi-reading driver, and ignores unused ones", () => {
    const h = blankHardware();
    const b = blankBinding(spec("mpu6050"), h, CATALOG);
    h.inputs = [{ ...b, channels: { ...b.channels, accel_x: "m1", accel_y: "m2" } }];
    expect([...takenTargets(h, "inputs").keys()]).toEqual(["m1", "m2"]);
  });

  it("keeps the first holder when a saved draft feeds one metric twice", () => {
    const h = hardwareToDraft({ ...SAVED, inputs: [SAVED.inputs![0], { ...SAVED.inputs![1], channels: { value: "door" } }] }, rows)!;
    expect(takenTargets(h, "inputs").get("m1")).toBe("hardware.inputs.0.channels.value");
  });
});

describe("moveToBoard", () => {
  const relayAndProbe = () => {
    let h = blankHardware("esp32-devkit-30");
    h = { ...h, outputs: [{ ...blankBinding(spec("relay"), h, CATALOG), pins: { pin: 23 } }] };
    h = { ...h, inputs: [{ ...blankBinding(spec("analog_in"), h, CATALOG), pins: { pin: 34 } }] };
    return h;
  };

  it("keeps every pin between the 30- and 38-pin DevKits", () => {
    const { hardware, moved } = moveToBoard(relayAndProbe(), "esp32-devkit-38", CATALOG);
    expect(moved).toEqual([]);
    expect(hardware.board).toBe("esp32-devkit-38");
    expect(hardware.outputs[0].pins.pin).toBe(23);
  });

  it("moves pins the C3 doesn't have to free ones that suit their role", () => {
    const { hardware, moved } = moveToBoard(relayAndProbe(), "esp32c3-supermini", CATALOG);
    const c3 = MODELS.find((m) => m.id === "esp32c3-supermini")!;
    const relay = hardware.outputs[0].pins.pin!;
    const analog = hardware.inputs[0].pins.pin!;
    expect(c3.pins).toContain(relay);
    expect([0, 1, 3, 4]).toContain(analog); // ADC1 on the C3
    expect(relay).not.toBe(analog);
    expect(moved.map((m) => m.from).sort()).toEqual([23, 34]);
    const pinErrors = Object.keys(validateHardware(hardware, { metrics: [], actuators: [] }, CATALOG).errors).filter((p) => p.includes(".pins."));
    expect(pinErrors).toEqual([]);
  });

  it("puts the I2C bus on the new board's default pins", () => {
    let h = blankHardware("esp32-devkit-30");
    h = syncI2c({ ...h, inputs: [blankBinding(spec("mpu6050"), h, CATALOG)] }, CATALOG);
    expect(h.i2c).toEqual({ sda: 21, scl: 22 });
    const { hardware } = moveToBoard(h, "esp32c3-supermini", CATALOG);
    expect(hardware.i2c).toEqual({ sda: 5, scl: 6 });
  });

  it("lists parts the new board's firmware doesn't carry, and validation flags them", () => {
    // As if the relay driver were built for the classic ESP32 only.
    const esp32Only: HardwareCatalog = { ...CATALOG, drivers: DRIVERS.map((d) => (d.id === "relay" ? { ...d, chips: ["esp32" as const] } : d)) };
    const { hardware, unsupported } = moveToBoard(relayAndProbe(), "esp32c3-supermini", esp32Only);
    expect(unsupported).toEqual([spec("relay").label]);
    expect(validateHardware(hardware, rows, esp32Only).errors["hardware.outputs.0.driver"]).toMatch(/doesn't include/);
    expect(moveToBoard(relayAndProbe(), "esp32-devkit-38", esp32Only).unsupported).toEqual([]);
  });

  it("leaves a pin empty when the new board has none left", () => {
    let h = blankHardware("esp32-devkit-30");
    for (let i = 0; i < 12; i++) h = { ...h, outputs: [...h.outputs, blankBinding(spec("relay"), h, CATALOG)] };
    const { hardware, moved } = moveToBoard(h, "esp32c3-supermini", CATALOG);
    expect(hardware.outputs.some((b) => b.pins.pin == null)).toBe(true);
    expect(moved.some((m) => m.to == null)).toBe(true);
  });
});

describe("driversFor", () => {
  it("offers a driver only on the chips that carry it; no chips means all", () => {
    const c3 = MODELS.find((m) => m.id === "esp32c3-supermini")!;
    const drivers = [{ ...spec("relay"), chips: ["esp32" as const] }, spec("pwm")];
    expect(driversFor(drivers, c3).map((d) => d.id)).toEqual(["pwm"]);
    expect(driversFor(drivers, undefined).map((d) => d.id)).toEqual(["relay", "pwm"]);
  });
});

describe("hasCapability", () => {
  it("reads a model's capabilities, and counts boards from older releases as having BLE", () => {
    expect(hasCapability({ capabilities: ["ble"] }, "ble")).toBe(true);
    expect(hasCapability({ capabilities: [] }, "ble")).toBe(false);
    expect(hasCapability({}, "ble")).toBe(true);
    // Every board but the S2 (no Bluetooth) sets up Wi-Fi from a phone.
    expect(MODELS.filter((m) => m.chip !== "esp32s2").every((m) => hasCapability(m, "ble"))).toBe(true);
  });
});

describe("board models", () => {
  it("never offer their own reset button or status LED for wiring, on any chip", () => {
    for (const m of MODELS) {
      const offered = new Set([...pinsFor(m, "input"), ...pinsFor(m, "output")]);
      expect(offered.has(m.reset.pin), `${m.id} reset`).toBe(false);
      if (m.led.type !== "none") expect(offered.has(m.led.pin), `${m.id} LED`).toBe(false);
    }
  });

  it("an ESP32-S3 DevKitC-1 reads analog on ADC1 and keeps its RGB LED to itself", () => {
    const s3 = MODELS.find((m) => m.id === "esp32s3-devkitc-1")!;
    expect(hasCapability(s3, "rgb_led")).toBe(true);
    expect(pinsFor(s3, "adc1")).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(pinsFor(s3, "output")).not.toContain(48);
    const v11 = MODELS.find((m) => m.id === "esp32s3-devkitc-1-v11")!;
    expect(pinsFor(v11, "output")).toContain(48);
    expect(pinsFor(v11, "output")).not.toContain(38);
  });
});

describe("ESP32-C6", () => {
  it("reads analog only on ADC1's GPIO 0-3 and 6, and keeps BOOT and its LED out of wiring", () => {
    const c6 = MODELS.find((m) => m.id === "esp32c6-devkitc-1")!;
    expect(pinsFor(c6, "adc1")).toEqual([0, 1, 2, 3, 6]);
    expect(pinsFor(c6, "input")).not.toContain(8);
    expect(pinsFor(c6, "input")).not.toContain(9);
    // An I2C part lands on the C6's default bus.
    expect(moveToBoard(syncI2c({ ...blankHardware("esp32-devkit-30"), inputs: [blankBinding(spec("mpu6050"), blankHardware("esp32-devkit-30"), CATALOG)] }, CATALOG), "esp32c6-devkitc-1", CATALOG).hardware.i2c).toEqual({ sda: 23, scl: 22 });
  });
});

describe("drivers per chip in the shipped catalog", () => {
  it("the C6 build has no DS18B20 (OneWire doesn't build for it); the others do", () => {
    const ids = (id: string) => driversFor(DRIVERS, MODELS.find((m) => m.id === id)).map((d) => d.id);
    expect(ids("esp32c6-devkitc-1")).not.toContain("ds18b20");
    expect(ids("esp32-devkit-30")).toContain("ds18b20");
    expect(ids("esp32s3-devkitc-1")).toContain("ds18b20");
    expect(ids("lolin-s2-mini")).toContain("ds18b20");
  });
});

describe("Lolin S2 Mini", () => {
  it("has no phone setup, and keeps its LED and BOOT out of wiring", () => {
    const s2 = MODELS.find((m) => m.id === "lolin-s2-mini")!;
    expect(hasCapability(s2, "ble")).toBe(false);
    expect(pinsFor(s2, "output")).not.toContain(15);
    expect(pinsFor(s2, "input")).not.toContain(0);
    expect(pinsFor(s2, "adc1")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
