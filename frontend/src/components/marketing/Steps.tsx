import { cn } from "@/lib/cn";

/** Numbered step cards (demo G .steps4): "01" in mono accent above each step.
 * `active` (vertical lists only) marks the step an illustration beside it is
 * showing: accent border and aria-current="step". */
export function Steps({ steps, vertical, active }: { steps: [string, string][]; vertical?: boolean; active?: number }) {
  return (
    <ol className={cn("grid gap-4", vertical ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {steps.map(([t, d], i) => (
        <li
          key={t}
          aria-current={active === i ? "step" : undefined}
          className={cn(
            "flex flex-col gap-1.5 rounded-xl border p-[18px] text-sm transition-colors duration-300",
            vertical ? "bg-surface" : "bg-canvas",
            active === i ? "border-accent shadow-[0_0_0_3px_var(--color-accent-muted)]" : "border-border",
          )}
        >
          <span className="font-mono text-[12px] font-semibold text-accent">{String(i + 1).padStart(2, "0")}</span>
          <b className="text-[16px] text-ink">{t}</b>
          <span className="leading-[1.55] text-ink-muted">{d}</span>
        </li>
      ))}
    </ol>
  );
}
