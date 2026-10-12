/** Min/max decimation for a line far denser than the pixels it's drawn on
 * (docs/plans/web-realtime.md): 20 Hz over a 10m window is 12,000 points
 * for a few hundred pixels, and drawing them all on every live flush was
 * the dashboard's remaining long task.
 *
 * Splits [xs[0], xs[last]] into `buckets` equal time slices and keeps each
 * slice's lowest and highest reading (in time order), plus the series' first
 * and last points — so spikes survive and the trace looks the same at that
 * width. Returns the input untouched when it's already sparse enough. */
export function decimateMinMax(xs: number[], ys: number[], buckets: number): [number[], number[]] {
  const n = xs.length;
  if (buckets < 1 || n <= buckets * 2) return [xs, ys];

  const outX: number[] = [];
  const outY: number[] = [];
  const push = (i: number) => {
    if (outX.length > 0 && outX[outX.length - 1] === xs[i]) return;
    outX.push(xs[i]);
    outY.push(ys[i]);
  };

  const x0 = xs[0];
  const span = xs[n - 1] - x0 || 1;
  push(0);
  let i = 1;
  for (let b = 0; b < buckets && i < n - 1; b++) {
    const end = x0 + (span * (b + 1)) / buckets;
    let minI = -1;
    let maxI = -1;
    for (; i < n - 1 && (xs[i] <= end || b === buckets - 1); i++) {
      if (minI < 0 || ys[i] < ys[minI]) minI = i;
      if (maxI < 0 || ys[i] > ys[maxI]) maxI = i;
    }
    if (minI < 0) continue;
    if (minI < maxI) {
      push(minI);
      push(maxI);
    } else {
      push(maxI);
      push(minI);
    }
  }
  push(n - 1);
  return [outX, outY];
}
