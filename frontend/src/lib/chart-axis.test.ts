import { describe, expect, it } from "vitest";
import { axisIncrs, axisLabels, stepDecimals } from "./chart-axis";

describe("axisIncrs", () => {
  it("stops at the metric's last digit", () => {
    const incrs = axisIncrs(3);
    expect(incrs[0]).toBe(0.001);
    expect(incrs).not.toContain(0.0005);
    expect(incrs.slice(0, 4)).toEqual([0.001, 0.002, 0.005, 0.01]);
  });

  it("allows whole-number steps only when decimals is 0", () => {
    expect(axisIncrs(0)[0]).toBe(1);
  });

  it("falls back to a fine floor when decimals is unset", () => {
    expect(axisIncrs(null)[0]).toBe(1e-10);
    expect(axisIncrs(undefined)).toContain(0.0005);
  });

  it("never uses a 2.5 step, so labels need no extra digit", () => {
    expect(axisIncrs(null).some((v) => Math.abs(v / 10 ** Math.floor(Math.log10(v)) - 2.5) < 1e-9)).toBe(false);
  });
});

describe("stepDecimals", () => {
  it.each([
    [0.001, 3],
    [0.002, 3],
    [0.005, 3],
    [0.01, 2],
    [0.0005, 4],
    [1, 0],
    [50, 0],
  ])("%s → %s", (incr, d) => expect(stepDecimals(incr)).toBe(d));
});

describe("axisLabels", () => {
  it("keeps neighbouring gridlines distinct (the old 0.049 / 0.049 bug)", () => {
    const labels = axisLabels([0.048, 0.0485, 0.049, 0.0495, 0.05], 0.0005);
    expect(labels).toEqual(["0.0480", "0.0485", "0.0490", "0.0495", "0.0500"]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("pads to the step's decimals", () => {
    expect(axisLabels([0.048, 0.049, 0.05], 0.001)).toEqual(["0.048", "0.049", "0.050"]);
  });
});
