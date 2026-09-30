"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Muted line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned; the primary action goes last. */
  footer?: ReactNode;
  /** Wraps the body in a <form>; Enter submits. */
  onSubmit?: (e: FormEvent) => void;
  wide?: boolean;
}

/** A modal dialog (DESIGN.md §5) for small create flows — "New dashboard",
 * "Create workspace", "Add widget". Destructive confirms use ConfirmDialog.
 * Scrim, focus trap, Esc, focus returns to the trigger. */
export function Dialog({ open, onClose, title, description, children, footer, onSubmit, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const body = (
    <>
      <div>
        <h2 id={titleId} className="text-[17px] font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {children && <div className="flex flex-col gap-3 text-sm text-ink">{children}</div>}
      {footer && <div className="mt-1.5 flex flex-wrap justify-end gap-2">{footer}</div>}
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-scrim p-4 motion-safe:animate-[fade_.12s]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "flex max-h-[calc(100vh-32px)] w-full flex-col gap-3 overflow-auto rounded-2xl border border-border bg-pop p-5 shadow-pop outline-none",
          wide ? "max-w-[620px]" : "max-w-[460px]",
        )}
      >
        {onSubmit ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body,
  );
}
