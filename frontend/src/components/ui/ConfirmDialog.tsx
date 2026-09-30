"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buttonClassName } from "@/components/ui/Button";

export interface ConfirmDialogProps {
  open: boolean;
  /** States the action ("Delete bay1-climate?"). */
  title?: string;
  /** States the consequence, with real numbers where there are any. */
  message: ReactNode;
  /** Optional itemised consequence (affected rules, devices…). */
  details?: ReactNode;
  /** Repeats the verb ("Delete device"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Filled red confirm button (the default — nearly every caller is a
   * delete/revoke). Set `false` for a neutral confirm. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** DESIGN.md §5 ConfirmDialog — every destructive action and guard routes
 * through this instead of `window.confirm()`. Focus is trapped between its
 * buttons, starts on Cancel (the safe choice) and returns to the trigger. */
export function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-scrim p-4 motion-safe:animate-[fade_.12s]">
      <button type="button" aria-label="Dismiss" tabIndex={-1} onClick={onCancel} className="absolute inset-0 cursor-default" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : confirmLabel}
        aria-describedby={bodyId}
        className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[460px] flex-col gap-3 overflow-auto rounded-2xl border border-border bg-pop p-5 shadow-pop"
      >
        {title && (
          <h2 id={titleId} className="text-[17px] font-semibold text-ink">
            {title}
          </h2>
        )}
        <div id={bodyId} className="flex flex-col gap-2.5 text-sm text-ink-muted [&_strong]:text-ink">
          {typeof message === "string" ? <p>{message}</p> : message}
          {details && (
            <div className="rounded-md bg-surface-raised px-3 py-2 text-xs text-ink [&_ul]:grid [&_ul]:gap-[3px]">
              {details}
            </div>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={buttonClassName({ variant: "secondary" })}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={buttonClassName({ variant: danger ? "danger" : "primary" })}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOptions {
  title?: string;
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  message: ReactNode;
  resolve: (confirmed: boolean) => void;
}

/** Pairs with `ConfirmDialog` to keep the `window.confirm()` call shape:
 * `if (!(await confirm("Delete X?"))) return;`. Render `{dialog}` once in the
 * component's JSX — it no-ops until `confirm()` is called. */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  function confirm(message: ReactNode, options?: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => setState({ message, resolve, ...options }));
  }

  const dialog = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title}
      message={state?.message ?? ""}
      details={state?.details}
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
