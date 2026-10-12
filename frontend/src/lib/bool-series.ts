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
 * Takes the buckets as aligned columns (`times` in epoch seconds) and returns
 * uPlot's aligned [x seconds, y] arrays (y null = gap). */
export function boolBuckets(times: number[], values: number[], bucketSec: number): [number[], (number | null)[]] {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  times.forEach((t, i) => {
    const value = values[i];
    const pure = value <= 0 || value >= 1;
    const v = value > 0 ? 1 : 0;
    xs.push(t);
    ys.push(v);
    if (pure) return;
    const end = t + bucketSec;
    const hasNext = i + 1 < times.length;
    const nextT = hasNext ? times[i + 1] : Infinity;
    if (nextT <= end) return;
    // Hold On to the bucket's end, then break the line.
    xs.push(end - 0.001);
    ys.push(v);
    if (hasNext) {
      xs.push(end);
      ys.push(null);
    }
  });
  return [xs, ys];
}
