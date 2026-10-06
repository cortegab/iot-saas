import { cn } from "@/lib/cn";

/** One time bucket in a rule's activity strip:
 * `idle` — condition false · `true` — condition true · `unknown` — no/stale
 * data (hatched, never coloured as false) · `fired` — the rule fired. */
export type StripCell = "idle" | "true" | "unknown" | "fired";

/** DESIGN.md §5 Mini strip: the rule's last 24 h at a glance. `mini` (48
 * cells, 10px tall) sits in a table row; `replay` is the full-width preview
 * strip with an hour axis. Data cells use `--color-chart`; fire marks use the
 * accent. */
export function MiniStrip({
  cells,
  variant = "mini",
  label,
  axis,
  className,
}: {
  cells: StripCell[];
  variant?: "mini" | "replay";
  /** Accessible summary, e.g. "Fired 2 times in 24 h". */
  label: string;
  /** Replay only: axis labels spread evenly under the strip. */
  axis?: string[];
  className?: string;
}) {
  const isMini = variant === "mini";
  return (
    <div className={cn(isMini ? "inline-flex" : "flex flex-col gap-1", className)}>
      <div
        role="img"
        aria-label={label}
        className={cn("grid gap-px", isMini ? "h-2.5" : "h-[22px] w-full")}
        style={{
          gridTemplateColumns: isMini ? `repeat(${cells.length}, 2px)` : `repeat(${cells.length}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((c, i) => (
          <i
            key={i}
            className={cn(
              "block rounded-[1px]",
              c === "idle" && "bg-surface-raised",
              c === "true" && "bg-chart/55",
              c === "unknown" && "hatch",
              c === "fired" && (isMini ? "bg-accent" : "bg-accent shadow-[0_-5px_0_var(--color-accent)]"),
            )}
          />
        ))}
      </div>
      {!isMini && axis && (
        <div className="flex justify-between font-mono text-[11px] text-ink-muted">
          {axis.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      )}
    </div>
  );
}
