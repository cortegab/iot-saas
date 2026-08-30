import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FieldProps {
  label: string;
  /** Small muted helper line under the control. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A labelled form field: the canonical uppercase label recipe (globals.css /
 * `Section.tsx` / the prototype's `.field-label`) over its control. The
 * wrapping `<label>` is the control's accessible name, so a field inside a
 * `Field` should NOT also carry an `aria-label`.
 *
 * This is the one field recipe for every Card-wrapped form (the catalog
 * editor and the rule builder). */
export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}
