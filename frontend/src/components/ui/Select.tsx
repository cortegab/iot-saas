import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { CONTROL_BASE, CONTROL_SIZE } from "@/components/ui/Input";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  compact?: boolean;
}

/** Native select in the shared control recipe; `.ui-select` (globals.css)
 * swaps the OS arrow for the design's chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { compact = false, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        CONTROL_BASE,
        compact ? CONTROL_SIZE.compact : CONTROL_SIZE.default,
        "ui-select pr-8",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
