import { describe, expect, it } from "vitest";
import { boolBuckets } from "@/lib/bool-series";

const at = (min: number) => new Date(Date.UTC(2026, 9, 3, 21, min)).toISOString();
const sec = (min: number) => Date.UTC(2026, 9, 3, 21, min) / 1000;

describe("boolBuckets", () => {
  it("carries a pure bucket's state forward to the next bucket", () => {
    const [xs, ys] = boolBuckets([{ time: at(0), value: 1 }, { time: at(10), value: 0 }], 60);
    expect(xs).toEqual([sec(0), sec(10)]);
    expect(ys).toEqual([1, 0]);
  });

  it("draws a mixed bucket On for its own minute, then breaks the line", () => {
    const [xs, ys] = boolBuckets([{ time: at(0), value: 0.5 }, { time: at(10), value: 0 }], 60);
    expect(xs).toEqual([sec(0), sec(1) - 0.001, sec(1), sec(10)]);
    expect(ys).toEqual([1, 1, null, 0]);
  });

  it("needs no break between adjacent buckets, and keeps the last mixed one visible", () => {
    const [xs, ys] = boolBuckets([{ time: at(0), value: 0.5 }, { time: at(1), value: 0.25 }], 60);
    expect(xs).toEqual([sec(0), sec(1), sec(2) - 0.001]);
    expect(ys).toEqual([1, 1, 1]);
  });
});
