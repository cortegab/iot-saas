import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MetricProps {
  label: string;
  value: ReactNode;
  /** Small note under the value — a unit, a timestamp, a delta. */
  hint?: ReactNode;
  /** Render the value in the data colour instead of ink (a screen's primary
   * reading). */
  accent?: boolean;
  className?: string;
}

/** A compact metric tile (DESIGN.md §5 Readout / Metric): Geist, tabular
 * figures, muted label. Drop several into a `grid` or `flex-wrap`. */
export function Metric({ label, value, hint, accent = false, className }: MetricProps) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-surface p-3.5 shadow-card", className)}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em]",
          accent ? "text-chart" : "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
