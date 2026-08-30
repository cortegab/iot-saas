"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Filled red confirm button for destructive actions (the default — nearly
   * every caller is a delete/revoke). Set `false` for a neutral confirm. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Themed replacement for `window.confirm()` — every destructive action in
 * the app (device/rule/dashboard delete, API key revoke, actuator command)
 * routes through this instead of the native dialog, which can't be themed
 * and breaks visual continuity in this app's dark-first design. Reuses the
 * same portal + backdrop-catcher + focus-trap shape `DropdownMenu` already
 * solved, simplified for exactly two focusable elements (Cancel/Confirm)
 * instead of an arbitrary-length item list. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Cancel is the safer default focus target for a destructive prompt.
    cancelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      e.preventDefault();
      const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
      next?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onCancel}
        className="fixed inset-0 z-40 cursor-default bg-canvas/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title ?? confirmLabel}
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        {title && <p className="text-sm font-medium text-ink">{title}</p>}
        <p className={cn("text-sm text-ink-muted", title && "mt-1")}>{message}</p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={buttonClassName({ variant: "secondary", size: "md" })}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              danger
                ? "border-status-error bg-status-error text-white hover:bg-status-error/90"
                : "border-accent bg-accent text-on-accent hover:bg-accent-strong hover:border-accent-strong",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (confirmed: boolean) => void;
}

/** Pairs with `ConfirmDialog` to preserve the call-site shape
 * `window.confirm()` had: `if (!(await confirm("Delete X?"))) return;`.
 * Render `{dialog}` once anywhere in the component's JSX output — it no-ops
 * until `confirm()` is called. */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  function confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => setState({ message, resolve, ...options }));
  }

  const dialog = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title}
      message={state?.message ?? ""}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      danger={state?.danger}
      onConfirm={() => {
        state?.resolve(true);
        setState(null);
      }}
      onCancel={() => {
        state?.resolve(false);
        setState(null);
      }}
    />
  );

  return { confirm, dialog };
}
