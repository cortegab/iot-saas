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
  /** A small link on the label row's right (e.g. "Forgot password?"). It
   * sits outside the <label>, so it isn't part of the control's name. */
  action?: ReactNode;
  /** Label on the left and the control (with its message line) on the
   * right, for lists of like fields such as a driver's readings. */
  inline?: boolean;
  children: ReactNode;
  className?: string;
}

/** A labelled form field (DESIGN.md §5): label above, control, one message
 * line below. The wrapping `<label>` is the control's accessible name, so the
 * control should NOT also carry an `aria-label`. When the child is a single
 * element, the message line is wired to it via `aria-describedby`, and
 * `aria-invalid` is set while there is an error. */
export function Field({ label, optional, hint, error, warning, action, inline, children, className }: FieldProps) {
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
    // content-start / self-start: a Field never stretches to its row's tallest
    // neighbour, so a hint under one field can't move or grow the next control.
    // w-full: in a flex-col parent self-start acts on the horizontal axis and
    // would shrink the Field to its content, so the width is set explicitly.
    <div className={cn("relative grid w-full min-w-0 content-start gap-[5px] self-start", inline && "grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3", className)}>
      <label className={cn("grid min-w-0 content-start gap-[5px]", inline && "col-span-2 grid-cols-subgrid items-center")}>
        <span className={cn("text-xs font-medium text-ink-muted", inline && "text-meta text-ink")}>
          {label}
          {optional && <span className="font-normal text-ink-muted"> · optional</span>}
        </span>
        {control}
      </label>
      {/* After the control in tab order; shown on the label row. */}
      {action && <span className="absolute right-0 top-0 text-xs leading-[1.4]">{action}</span>}
      {message != null && message !== false && (
        <span
          id={msgId}
          className={cn(
            "flex items-start gap-[5px] text-xs",
            inline && "col-start-2",
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
