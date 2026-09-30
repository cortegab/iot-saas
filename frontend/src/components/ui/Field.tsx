"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface FieldProps {
  label: ReactNode;
  /** Appends a muted "optional" to the label (DESIGN.md §5 Field). */
  optional?: boolean;
  /** Helper line under the control. Replaced by `error` / `warning`. */
  hint?: ReactNode;
  /** Error message — replaces the hint and marks the control `aria-invalid`. */
  error?: ReactNode;
  /** Warning (a risk, not a blocker) — replaces the hint. */
  warning?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A labelled form field (DESIGN.md §5): label above, control, one message
 * line below. The wrapping `<label>` is the control's accessible name, so the
 * control should NOT also carry an `aria-label`. When the child is a single
 * element, the message line is wired to it via `aria-describedby`, and
 * `aria-invalid` is set while there is an error. */
export function Field({ label, optional, hint, error, warning, children, className }: FieldProps) {
  const msgId = useId();
  const message = error ?? warning ?? hint;
  const tone = error ? "error" : warning ? "warning" : "hint";

  let control = children;
  if (isValidElement(children) && message != null && message !== false) {
    const el = children as ReactElement<Record<string, unknown>>;
    control = cloneElement(el, {
      "aria-describedby": cn(el.props["aria-describedby"] as string | undefined, msgId) || undefined,
      ...(error ? { "aria-invalid": true } : {}),
    });
  }

  // The <label> holds only the label text and the control, so the control's
  // accessible name is the label; the message line is its description.
  return (
    <div className={cn("flex min-w-0 flex-col gap-[5px]", className)}>
      <label className="flex min-w-0 flex-col gap-[5px]">
        <span className="text-xs font-medium text-ink-muted">
          {label}
          {optional && <span className="font-normal opacity-75"> · optional</span>}
        </span>
        {control}
      </label>
      {message != null && message !== false && (
        <span
          id={msgId}
          className={cn(
            "flex items-start gap-[5px] text-xs",
            tone === "error" && "text-status-error",
            tone === "warning" && "text-status-pending",
            tone === "hint" && "text-ink-muted",
          )}
        >
          {tone === "error" && <AlertCircle aria-hidden size={13} className="mt-0.5 shrink-0" />}
          {tone === "warning" && <AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" />}
          <span className="min-w-0">{message}</span>
        </span>
      )}
    </div>
  );
}
