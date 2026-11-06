import { describe, expect, it } from "vitest";
import { commandRange, controlKind, isRequested, parseCommand } from "./actuator-command";
import type { components } from "./api";

type CatalogActuator = components["schemas"]["CatalogActuator"];
type HardwareConfig = components["schemas"]["HardwareConfig"];

const actuator = (a: Partial<CatalogActuator>): CatalogActuator => ({ name: "fan1", value_type: "bool", ...a });
const wiring = (outputs: HardwareConfig["outputs"]): HardwareConfig => ({ board: "esp32-devkit-30", outputs });

describe("controlKind", () => {
  it("is a switch for on/off and for an undeclared actuator", () => {
    expect(controlKind(actuator({}))).toBe("switch");
    expect(controlKind(undefined)).toBe("switch");
  });
  it("is choices for a fixed list, else a typed-in number or text", () => {
    expect(controlKind(actuator({ value_type: "string", allowed_values: ["open", "closed"] }))).toBe("choices");
    expect(controlKind(actuator({ value_type: "float", allowed_values: [0, 50, 100] }))).toBe("choices");
    expect(controlKind(actuator({ value_type: "float" }))).toBe("number");
    expect(controlKind(actuator({ value_type: "string" }))).toBe("text");
  });
});

describe("commandRange", () => {
  it("reads a PWM output's command span, defaulting to 0–100", () => {
    expect(commandRange(wiring([{ driver: "pwm", channels: { value: "fan-speed" } }]), "fan-speed")).toEqual({ min: 0, max: 100 });
    expect(commandRange(wiring([{ driver: "pwm", params: { in_min: 255, in_max: 0 }, channels: { value: "dim" } }]), "dim")).toEqual({ min: 0, max: 255 });
  });
  it("reads a servo's angles, in degrees", () => {
    expect(commandRange(wiring([{ driver: "servo", params: { min_angle: 10, max_angle: 170 }, channels: { value: "vent" } }]), "vent")).toEqual({ min: 10, max: 170, unit: "°" });
  });
  it("is null when the actuator isn't wired to a ranged part", () => {
    expect(commandRange(null, "fan")).toBeNull();
    expect(commandRange(wiring([{ driver: "pwm", channels: { value: "other" } }]), "fan")).toBeNull();
    expect(commandRange(wiring([{ driver: "relay", channels: { value: "fan" } }]), "fan")).toBeNull();
  });
});

describe("parseCommand", () => {
  const range = { min: 0, max: 180, unit: "°" };
  it("accepts a number in range", () => {
    expect(parseCommand(" 90 ", "number", range)).toEqual({ value: 90 });
    expect(parseCommand("-5", "number", null)).toEqual({ value: -5 });
  });
  it("says what's wrong", () => {
    expect(parseCommand("", "number", range)).toEqual({ error: "Enter a value." });
    expect(parseCommand("abc", "number", range)).toEqual({ error: "Enter a number." });
    expect(parseCommand("200", "number", range)).toEqual({ error: "Between 0 and 180°." });
  });
  it("keeps text as typed, trimmed", () => {
    expect(parseCommand(" eco ", "text", null)).toEqual({ value: "eco" });
  });
});

describe("isRequested", () => {
  it("matches the value already requested", () => {
    expect(isRequested(false, false)).toBe(true);
    expect(isRequested(40, 40)).toBe(true);
    expect(isRequested(true, false)).toBe(false);
    expect(isRequested(1, true)).toBe(false);
  });
  it("is false when nothing was requested yet", () => {
    expect(isRequested(false, null)).toBe(false);
    expect(isRequested(false, undefined)).toBe(false);
  });
});
