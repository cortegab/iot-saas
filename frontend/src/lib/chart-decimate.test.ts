import { describe, expect, it } from "vitest";
import { decimateMinMax } from "@/lib/chart-decimate";

describe("decimateMinMax", () => {
  it("leaves a sparse series untouched", () => {
    const xs = [1, 2, 3];
    const ys = [5, 6, 7];
    const [dx, dy] = decimateMinMax(xs, ys, 10);
    expect(dx).toBe(xs);
    expect(dy).toBe(ys);
  });

  it("keeps each bucket's min and max in time order, plus the ends", () => {
    // 0..99 at 1 s, a spike at 42 and a dip at 77.
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const ys = xs.map((i) => (i === 42 ? 100 : i === 77 ? -100 : 0));
    const [dx, dy] = decimateMinMax(xs, ys, 4);

    expect(dx[0]).toBe(0);
    expect(dx[dx.length - 1]).toBe(99);
    expect(dy).toContain(100);
    expect(dy).toContain(-100);
    expect(dx.indexOf(42)).toBeLessThan(dx.indexOf(77));
    expect(dx.length).toBeLessThanOrEqual(4 * 2 + 2);
    // Strictly increasing x — uPlot needs sorted data.
    for (let i = 1; i < dx.length; i++) expect(dx[i]).toBeGreaterThan(dx[i - 1]);
  });

  it("stays bounded for a dense series", () => {
    const xs = Array.from({ length: 12_000 }, (_, i) => i / 20);
    const ys = xs.map((x) => Math.sin(x));
    const [dx] = decimateMinMax(xs, ys, 400);
    expect(dx.length).toBeLessThanOrEqual(802);
  });
});
