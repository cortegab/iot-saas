import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One fact: a label and its value. Falsy entries are skipped, so a caller can
 * write `cond && ["Revoked", when]`. */
export type Fact = readonly [label: string, value: ReactNode];

/** A record's read-only facts (DESIGN.md §5 FactList): a muted 140px label
 * column beside the value, stacked on phones. A value may link to its source
 * or carry inline link actions (Copy, Rotate credential…). Never a disabled
 * input, a grey box or a loose sentence for a fact. */
export function FactList({ facts, className }: { facts: (Fact | false | null | undefined)[]; className?: string }) {
  const shown = facts.filter((f): f is Fact => Boolean(f));
  if (shown.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 text-[13.5px] text-ink max-sm:grid-cols-1 max-sm:gap-y-1 max-sm:[&_dd]:mb-2",
        className,
      )}
    >
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="m-0 min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
