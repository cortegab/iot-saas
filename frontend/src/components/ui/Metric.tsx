import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MetricProps {
  label: string;
  value: ReactNode;
  /** Small note under the value — a unit, a timestamp, a delta. */
  hint?: ReactNode;
  /** Render the value in the chart/instrument color instead of ink (use for a
   * screen's primary reading). */
  accent?: boolean;
  className?: string;
}

/**
 * A compact metric tile — the panel-card version of the readings/value display
 * repeated ad hoc as `<Card padding="sm"><dt/><dd/>`. Drop several into a
 * `grid` or `flex-wrap` container.
 */
export function Metric({ label, value, hint, accent = false, className }: MetricProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border border-t-panel-edge bg-surface p-3",
        className,
      )}
    >
      <p className="font-mono text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular-nums",
          accent ? "text-chart" : "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
