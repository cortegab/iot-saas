import { describe, expect, it } from "vitest";
import { liveWindowMs, readingFreshness } from "@/lib/freshness";

const now = Date.parse("2026-10-21T12:00:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("readingFreshness", () => {
  it("is No data when nothing was received", () => {
    expect(readingFreshness(true, undefined, null, now)).toBe("none");
  });

  it("is Live inside three publish intervals while online", () => {
    const m = { publish: "periodic" as const, publish_interval_seconds: 10 };
    expect(readingFreshness(true, m, ago(29), now)).toBe("live");
    expect(readingFreshness(true, m, ago(31), now)).toBe("stale");
  });

  it("is Stale whenever the device is offline", () => {
    expect(readingFreshness(false, { publish: "streaming", publish_interval_seconds: null }, ago(1), now)).toBe("stale");
  });

  it("gives on-change metrics a day before they go stale", () => {
    expect(liveWindowMs({ publish: "on_change", publish_interval_seconds: null })).toBe(24 * 3600 * 1000);
    expect(readingFreshness(true, { publish: "on_change", publish_interval_seconds: null }, ago(3600), now)).toBe("live");
  });

  it("assumes a 30 s period when the metric isn't declared", () => {
    expect(liveWindowMs(undefined)).toBe(90_000);
  });
});
