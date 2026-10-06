import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { CONTROL_BASE, CONTROL_SIZE } from "@/components/ui/Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  compact?: boolean;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { compact = false, mono = false, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        CONTROL_BASE,
        compact ? CONTROL_SIZE.compact : CONTROL_SIZE.default,
        "resize-y leading-[1.45]",
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
});
