/** Aggregated on/off data for a step chart. A rollup bucket's average is the
 * share of its readings that were On, which says when the state is known:
 *
 * - a **pure** bucket (avg 0 or 1) held one state, so the step carries it
 *   forward until the next bucket with readings — a state that didn't change
 *   needs no new reading;
 * - a **mixed** bucket changed inside it: it's drawn On for its own width (it
 *   was On at some point), and the state after it is unknown, so the line
 *   breaks until the next bucket with readings.
 *
 * Returns uPlot's aligned [x seconds, y] arrays (y null = gap). */
export function boolBuckets(points: { time: string; value: number }[], bucketSec: number): [number[], (number | null)[]] {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  points.forEach((p, i) => {
    const t = Date.parse(p.time) / 1000;
    const pure = p.value <= 0 || p.value >= 1;
    const v = p.value > 0 ? 1 : 0;
    xs.push(t);
    ys.push(v);
    if (pure) return;
    const end = t + bucketSec;
    const next = points[i + 1];
    const nextT = next ? Date.parse(next.time) / 1000 : Infinity;
    if (nextT <= end) return;
    // Hold On to the bucket's end, then break the line.
    xs.push(end - 0.001);
    ys.push(v);
    if (next) {
      xs.push(end);
      ys.push(null);
    }
  });
  return [xs, ys];
}
