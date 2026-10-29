"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

/** A record's lasting state in the header's meta row (DESIGN.md §5 Callout):
 * an amber chip ("Can't evaluate") whose detail opens in a popover on click
 * or Enter, closing on Esc or a click outside. Used instead of a full-width
 * callout when the state holds no action to resolve it. */
export function StateChip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        chip.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !chip.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        ref={chip}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="hit inline-flex h-6 items-center gap-1 rounded-full bg-status-pending-surface px-2 text-xs font-medium text-status-pending hover:brightness-95"
      >
        <AlertTriangle aria-hidden size={12} />
        {label}
      </button>
      <div
        ref={panel}
        id={id}
        role="note"
        hidden={!open}
        className="absolute left-0 top-full z-30 mt-1.5 w-[min(340px,calc(100vw-32px))] rounded-lg border border-border bg-surface p-3 text-meta leading-snug text-ink shadow-pop"
      >
        {children}
      </div>
    </span>
  );
}
