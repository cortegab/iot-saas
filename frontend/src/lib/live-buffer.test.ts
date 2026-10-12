import { describe, expect, it } from "vitest";
import { LiveBuffer, appendToWindow, reseed, type LatestBatch, type LivePoint } from "@/lib/live-buffer";

function makeBuffer() {
  const state = { hidden: false, pending: null as (() => void) | null, scheduled: 0 };
  const buffer = new LiveBuffer({
    intervalMs: 250,
    schedule: (flush) => {
      state.scheduled++;
      state.pending = flush;
    },
    isHidden: () => state.hidden,
  });
  const runFlush = () => {
    const flush = state.pending;
    state.pending = null;
    flush?.();
  };
  return { buffer, state, runFlush };
}

describe("LiveBuffer", () => {
  it("coalesces many frames into one flush with the newest reading per metric", () => {
    const { buffer, state, runFlush } = makeBuffer();
    const batches: LatestBatch[] = [];
    buffer.setLatestHandler((b) => batches.push(b));

    for (let i = 0; i < 20; i++) buffer.push("d1", "temp", i, 100 + i / 20);
    buffer.push("d1", "hum", 50, 100);
    buffer.push("d2", "temp", 7, 100);
    expect(state.scheduled).toBe(1);

    runFlush();
    expect(batches).toHaveLength(1);
    expect(batches[0].get("d1")).toEqual([
      { metric: "temp", value: 19, t: 100 + 19 / 20 },
      { metric: "hum", value: 50, t: 100 },
    ]);
    expect(batches[0].get("d2")).toEqual([{ metric: "temp", value: 7, t: 100 }]);
  });

  it("keeps an older out-of-order frame from replacing the newest reading", () => {
    const { buffer, runFlush } = makeBuffer();
    const batches: LatestBatch[] = [];
    buffer.setLatestHandler((b) => batches.push(b));
    buffer.push("d1", "temp", 2, 200);
    buffer.push("d1", "temp", 1, 199);
    runFlush();
    expect(batches[0].get("d1")).toEqual([{ metric: "temp", value: 2, t: 200 }]);
  });

  it("hands a chart every point since the last flush, and only for series it subscribed to", () => {
    const { buffer, runFlush } = makeBuffer();
    const got: LivePoint[][] = [];
    const unsubscribe = buffer.subscribeSeries("d1", "temp", (p) => got.push(p));

    buffer.push("d1", "temp", 1, 10);
    buffer.push("d1", "temp", 2, 11);
    buffer.push("d1", "hum", 3, 11);
    runFlush();
    expect(got).toEqual([[{ t: 10, v: 1 }, { t: 11, v: 2 }]]);

    unsubscribe();
    buffer.push("d1", "temp", 4, 12);
    runFlush();
    expect(got).toHaveLength(1);
  });

  it("drops frames while hidden and schedules a new flush once visible again", () => {
    const { buffer, state, runFlush } = makeBuffer();
    const batches: LatestBatch[] = [];
    buffer.setLatestHandler((b) => batches.push(b));

    state.hidden = true;
    buffer.push("d1", "temp", 1, 10);
    expect(state.scheduled).toBe(0);

    state.hidden = false;
    buffer.push("d1", "temp", 2, 11);
    runFlush();
    expect(batches).toHaveLength(1);
    expect(batches[0].get("d1")).toEqual([{ metric: "temp", value: 2, t: 11 }]);
  });

  it("discards what was pending if the page went hidden before the flush ran", () => {
    const { buffer, state, runFlush } = makeBuffer();
    const batches: LatestBatch[] = [];
    buffer.setLatestHandler((b) => batches.push(b));
    buffer.push("d1", "temp", 1, 10);
    state.hidden = true;
    runFlush();
    state.hidden = false;
    buffer.push("d1", "temp", 2, 11);
    runFlush();
    expect(batches).toHaveLength(1);
    expect(batches[0].get("d1")).toEqual([{ metric: "temp", value: 2, t: 11 }]);
  });
});

describe("reseed", () => {
  it("keeps this series' live points newer than the fetched tip", () => {
    const prev = { id: "d|temp", xs: [1, 2, 3, 4], ys: [10, 20, 30, 40] };
    expect(reseed(prev, "d|temp", [1, 2], [11, 21])).toEqual({ id: "d|temp", xs: [1, 2, 3, 4], ys: [11, 21, 30, 40] });
  });

  it("drops another metric's points instead of carrying them over", () => {
    const prev = { id: "d|humidity", xs: [5, 6], ys: [80, 81] };
    expect(reseed(prev, "d|temp", [1, 2], [20, 21])).toEqual({ id: "d|temp", xs: [1, 2], ys: [20, 21] });
  });

  it("keeps the live tail when the fetch comes back empty", () => {
    const prev = { id: "d|temp", xs: [5, 6], ys: [20, 21] };
    expect(reseed(prev, "d|temp", [], [])).toEqual({ id: "d|temp", xs: [5, 6], ys: [20, 21] });
  });
});

describe("appendToWindow", () => {
  it("appends newer points and trims what slid out of the window", () => {
    const xs = [1, 2, 3];
    const ys = [10, 20, 30];
    appendToWindow(xs, ys, [{ t: 4, v: 40 }, { t: 5, v: 50 }], 3);
    expect(xs).toEqual([3, 4, 5]);
    expect(ys).toEqual([30, 40, 50]);
  });

  it("skips points not newer than the tip (already in the fetched series)", () => {
    const xs = [1, 2];
    const ys = [10, 20];
    appendToWindow(xs, ys, [{ t: 2, v: 99 }, { t: 1.5, v: 99 }, { t: 3, v: 30 }], 0);
    expect(xs).toEqual([1, 2, 3]);
    expect(ys).toEqual([10, 20, 30]);
  });

  it("can empty the window entirely", () => {
    const xs = [1, 2];
    const ys = [10, 20];
    appendToWindow(xs, ys, [], 5);
    expect(xs).toEqual([]);
    expect(ys).toEqual([]);
  });
});
