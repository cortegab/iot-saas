import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The one control recipe (DESIGN.md §5 Input / Select / Textarea): 36px,
 * `--color-input` fill, accent border + soft ring on focus, error border when
 * `aria-invalid`. Shared by Input, Select and Textarea. */
export const CONTROL_BASE =
  "w-full min-w-0 rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted/70 transition-[border-color,box-shadow] duration-150 hover:enabled:border-ink-muted/60 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20 focus-visible:outline-none aria-[invalid=true]:border-status-error disabled:cursor-not-allowed disabled:opacity-70";

/** `compact` is the 30px tier for toolbars and inline editors; the default is
 * the 36px form-field height. */
export const CONTROL_SIZE = {
  default: "min-h-control",
  compact: "min-h-[30px] py-1",
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  compact?: boolean;
  /** Monospace — for keys, topics and payloads. */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { compact = false, mono = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        CONTROL_BASE,
        compact ? CONTROL_SIZE.compact : CONTROL_SIZE.default,
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
});

/** A control with a unit/suffix inside its border (DESIGN.md §5 "Affix"), e.g.
 * `s`, `°C`. Wrap an `<Input>`. */
export function Affix({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch [&>input]:rounded-r-none">
      {children}
      <span className="grid place-items-center whitespace-nowrap rounded-r-md border border-l-0 border-border bg-surface-raised px-2.5 text-[13px] text-ink-muted">
        {suffix}
      </span>
    </div>
  );
}
