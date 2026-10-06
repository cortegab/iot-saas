import { describe, expect, it } from "vitest";
import { formatReading, isBoolMetric } from "@/lib/format-reading";

describe("formatReading", () => {
  it("shows an on/off metric as On / Off, whatever its decimals", () => {
    expect(formatReading(1, { data_type: "bool", decimals: 0 })).toBe("On");
    expect(formatReading(0, { data_type: "bool", decimals: 2 })).toBe("Off");
  });

  it("uses the template's decimals for a number, the raw value without", () => {
    expect(formatReading(27.456, { data_type: "float", decimals: 1 })).toBe("27.5");
    expect(formatReading(27.456, null)).toBe("27.456");
  });

  it("isBoolMetric is false without a template entry", () => {
    expect(isBoolMetric(undefined)).toBe(false);
    expect(isBoolMetric({ data_type: "bool" })).toBe(true);
  });
});
