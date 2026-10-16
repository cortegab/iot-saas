import { cn } from "@/lib/cn";

/** A thin progress bar (DESIGN.md §5): `value` 0–1, or undefined while the
 * job's length isn't known, which shows a sliding segment (static under
 * reduced motion). The visible stage text sits next to it; `label` names the
 * bar for screen readers and `valueText` says how far in words. */
export function ProgressBar({ value, label, valueText, className }: { value?: number; label: string; valueText?: string; className?: string }) {
  const pct = value == null ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-border", className)}
    >
      {pct != null ? (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      ) : (
        <div className="h-full w-2/5 rounded-full bg-accent motion-safe:animate-[progress-slide_1.4s_ease-in-out_infinite] motion-reduce:w-1/2 motion-reduce:bg-ink-muted/40" />
      )}
    </div>
  );
}
