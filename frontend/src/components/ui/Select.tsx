import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const BASE =
  "rounded-md border border-border bg-surface-raised text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

const SIZE_CLASSES = {
  default: "px-3 py-2",
  compact: "px-3 py-1.5 text-sm",
};

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  compact?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { compact = false, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(BASE, compact ? SIZE_CLASSES.compact : SIZE_CLASSES.default, className)}
      {...props}
    >
      {children}
    </select>
  );
});
