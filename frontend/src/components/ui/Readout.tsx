import { cn } from "@/lib/cn";

export interface ReadoutProps {
  /** Metric name — rendered as a mono uppercase eyebrow. */
  label: string;
  value: number | string;
  unit?: string;
  /** When both `min` and `max` are given and `value` is numeric, a linear
   * gauge track is drawn under the value. */
  min?: number;
  max?: number;
  /** Optional marker on the track (a rule threshold), drawn in the alert color. */
  threshold?: number;
  /** Small trailing note, e.g. "updated 10s ago". */
  stamp?: string;
  size?: "md" | "lg";
  className?: string;
}

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * The signature metric display: a large tabular value with a linear gauge that
 * places it between its min and max, with the rule threshold notched on the
 * track. This is the "instrument readout" the Control Room identity is built
 * around — used for the device hero metric, readings tiles, and value widgets.
 */
export function Readout({
  label,
  value,
  unit,
  min,
  max,
  threshold,
  stamp,
  size = "md",
  className,
}: ReadoutProps) {
  const numeric = typeof value === "number" ? value : Number(value);
  const showGauge = min != null && max != null && Number.isFinite(numeric);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <span
          className={cn(
            "font-mono font-semibold leading-none text-chart tabular-nums",
            size === "lg" ? "text-4xl" : "text-2xl",
          )}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {unit && <span className="font-mono text-sm text-ink-muted">{unit}</span>}
        {stamp && <span className="ml-auto font-mono text-xs text-ink-muted">{stamp}</span>}
      </div>

      {showGauge && (
        <div>
          <div className="relative">
            <div className="h-2 overflow-hidden rounded-sm bg-surface-raised">
              <div className="h-full bg-chart" style={{ width: `${pct(numeric, min, max)}%` }} />
            </div>
            {threshold != null && (
              <div
                aria-hidden
                className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-status-offline"
                style={{ left: `${pct(threshold, min, max)}%` }}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted tabular-nums">
            <span>{min.toLocaleString()}</span>
            {threshold != null && <span>⌁ {threshold.toLocaleString()}</span>}
            <span>{max.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
