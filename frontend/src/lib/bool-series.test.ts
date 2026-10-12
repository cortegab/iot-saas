import { describe, expect, it } from "vitest";
import { boolBuckets } from "@/lib/bool-series";

const sec = (min: number) => Date.UTC(2026, 9, 3, 21, min) / 1000;

describe("boolBuckets", () => {
  it("carries a pure bucket's state forward to the next bucket", () => {
    const [xs, ys] = boolBuckets([sec(0), sec(10)], [1, 0], 60);
    expect(xs).toEqual([sec(0), sec(10)]);
    expect(ys).toEqual([1, 0]);
  });

  it("draws a mixed bucket On for its own minute, then breaks the line", () => {
    const [xs, ys] = boolBuckets([sec(0), sec(10)], [0.5, 0], 60);
    expect(xs).toEqual([sec(0), sec(1) - 0.001, sec(1), sec(10)]);
    expect(ys).toEqual([1, 1, null, 0]);
  });

  it("needs no break between adjacent buckets, and keeps the last mixed one visible", () => {
    const [xs, ys] = boolBuckets([sec(0), sec(1)], [0.5, 0.25], 60);
    expect(xs).toEqual([sec(0), sec(1), sec(2) - 0.001]);
    expect(ys).toEqual([1, 1, 1]);
  });
});
