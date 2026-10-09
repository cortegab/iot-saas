import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE_MS, RANGE_OPTIONS, pinnedWindow, slideIntervalMs } from "@/lib/chart-range";

describe("RANGE_OPTIONS", () => {
  it("starts with 1m and opens on 10m", () => {
    expect(RANGE_OPTIONS.map((o) => o.label)).toEqual(["1m", "10m", "1h", "6h", "24h", "7d"]);
    expect(DEFAULT_RANGE_MS).toBe(10 * 60 * 1000);
  });
});

describe("slideIntervalMs", () => {
  it("slides about 120 times per window, between 1 s and 60 s", () => {
    expect(slideIntervalMs(60_000)).toBe(1_000);
    expect(slideIntervalMs(10 * 60_000)).toBe(5_000);
    expect(slideIntervalMs(60 * 60_000)).toBe(30_000);
    expect(slideIntervalMs(24 * 60 * 60_000)).toBe(60_000);
    expect(slideIntervalMs(1_000)).toBe(1_000);
  });
});

describe("pinnedWindow", () => {
  it("spans the whole range in seconds, ending now", () => {
    expect(pinnedWindow(60_000, 1_770_000_000_000)).toEqual([1_769_999_940, 1_770_000_000]);
  });
});
