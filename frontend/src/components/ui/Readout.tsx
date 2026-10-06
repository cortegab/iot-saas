import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ReadoutProps {
  /** Omitted when the surrounding card already names the metric. */
  label?: string;
  value: number | string;
  unit?: string;
  /** Gauge range; the gauge shows only when both are known. */
  min?: number;
  max?: number;
  /** A rule threshold, notched on the gauge and named in the foot. */
  threshold?: number;
  /** Muted foot line ("updated 2 min ago", "No data yet"). */
  stamp?: string;
  /** The value is the last one heard, not a live one: dimmed, with the stamp
   * in the warning tone (stale data is never shown as current). */
  stale?: boolean;
  size?: "md" | "lg";
  /** Card chrome (border, surface, padding). Off inside a widget that
   * already draws its own card. */
  framed?: boolean;
  className?: string;
}

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * The signature metric display (DESIGN.md §5 "Readout / Metric", demo G
 * `.readout`): label, a large tabular value with its unit muted, and a gauge
 * placing it between min and max with the rule threshold notched — used for
 * the device readings grid and value widgets.
 */
export function Readout({
  label,
  value,
  unit,
  min,
  max,
  threshold,
  stamp,
  stale = false,
  size = "md",
  framed = true,
  className,
}: ReadoutProps) {
  const numeric = typeof value === "number" ? value : Number(value);
  const showGauge = min != null && max != null && Number.isFinite(numeric);

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5",
        framed && "rounded-xl border border-border bg-surface p-3.5 shadow-card",
        className,
      )}
    >
      {label && <span className="text-xs text-ink-muted">{label}</span>}
      <span
        className={cn(
          "flex items-baseline gap-[5px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink tabular-nums",
          size === "lg" ? "text-[40px]" : "text-[28px]",
          stale && "opacity-55",
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
        {unit && <span className="text-sm font-normal tracking-normal text-ink-muted">{unit}</span>}
      </span>

      {showGauge && (
        <>
          <span aria-hidden className="relative mt-1 h-[5px] rounded-[3px] bg-surface-raised">
            <span className="absolute inset-y-0 left-0 rounded-[3px] bg-chart" style={{ width: `${pct(numeric, min, max)}%` }} />
            {threshold != null && (
              <span
                className="absolute -bottom-1 -top-1 -ml-px w-0.5 rounded-[1px] bg-ink"
                style={{ left: `${pct(threshold, min, max)}%` }}
              />
            )}
          </span>
          <span className="flex justify-between gap-1.5 text-[11px] text-ink-muted tabular-nums">
            <span>{min.toLocaleString()}</span>
            {threshold != null && <span className="text-ink">rule at {threshold.toLocaleString()}</span>}
            <span>{max.toLocaleString()}</span>
          </span>
        </>
      )}

      {stamp &&
        (stale ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-status-pending">
            <AlertTriangle aria-hidden size={12} />
            {stamp}
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted">{stamp}</span>
        ))}
    </div>
  );
}
