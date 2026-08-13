import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const BASE =
  "rounded-md border border-border bg-surface-raised text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

/** `compact` is the secondary density tier already used for filter/toolbar
 * fields (search boxes, list filters) — `false` (default) is the primary
 * form-field density used inside `Card`-wrapped forms. */
const SIZE_CLASSES = {
  default: "px-3 py-2",
  compact: "px-3 py-1.5 text-sm",
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { compact = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(BASE, compact ? SIZE_CLASSES.compact : SIZE_CLASSES.default, className)}
      {...props}
    />
  );
});
