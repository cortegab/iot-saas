/**
 * The numeric y axis of a trend chart: which gridline steps it may use and
 * how each gridline is labelled.
 *
 * uPlot's defaults allow any step down to 1e-16 (including 2.5×10ⁿ) but
 * label with at most 3 decimals, so a 0.0005 step drew 0.0485 and 0.049 both
 * as "0.049". Here every step is 1, 2 or 5 × 10ⁿ, so a label needs exactly
 * as many decimals as its step has; and a metric with `decimals` set never
 * gets a step finer than its last digit — readings sent at 3 decimals sit on
 * 0.001 boundaries, so gridlines between them would only mark noise.
 */

const MANTISSAS = [1, 2, 5];
/** Finest step when the metric has no decimals set (uPlot's own floor is 1e-16). */
const DEFAULT_MIN_EXP = -10;
const MAX_EXP = 15;

/** Allowed gridline steps, finest first. */
export function axisIncrs(decimals?: number | null): number[] {
  const minExp = decimals != null && decimals >= 0 ? -decimals : DEFAULT_MIN_EXP;
  const incrs: number[] = [];
  for (let exp = minExp; exp <= MAX_EXP; exp++) {
    for (const m of MANTISSAS) {
      // toFixed/Number round-trip keeps 0.1 × 3 style float error out of the steps.
      incrs.push(Number((m * 10 ** exp).toFixed(Math.max(0, -exp))));
    }
  }
  return incrs;
}

/** Decimals a label needs so neighbouring gridlines `incr` apart stay distinct. */
export function stepDecimals(incr: number): number {
  if (!(incr > 0) || !Number.isFinite(incr)) return 0;
  // Steps are 1/2/5 × 10ⁿ, so the exponent alone decides; the epsilon absorbs
  // log10 landing a hair under an integer (log10(0.001) = -2.9999…).
  return Math.max(0, -Math.floor(Math.log10(incr) + 1e-9));
}

/** Gridline labels for one step: fixed decimals, so 0.048 / 0.049 / 0.050
 * rather than 0.048 / 0.049 / 0.05. */
export function axisLabels(splits: number[], incr: number): string[] {
  const d = stepDecimals(incr);
  return splits.map((v) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(d)));
}
