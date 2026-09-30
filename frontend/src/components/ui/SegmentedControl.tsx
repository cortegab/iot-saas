"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** `subtle` (default) — the selected segment lifts onto the surface (modes,
   * ranges, AND/OR). `solid` — the selected segment fills with the accent, for
   * a control that IS the value being set (an actuator command). */
  variant?: "subtle" | "solid";
  /** `sm` (default) for toolbars and inline choices; `md` is the 36px form
   * height (DESIGN.md §12 touch targets). */
  size?: "sm" | "md";
  className?: string;
}

/** The app's one segmented control (DESIGN.md §5): a radiogroup of mutually
 * exclusive options. Arrow keys move the selection. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "subtle",
  size = "sm",
  className,
}: SegmentedControlProps<T>) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = enabled[(i + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`);
    btn?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md border border-border bg-surface-raised p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const checked = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={opt.value}
            tabIndex={checked ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              size === "md" ? "min-h-[30px] text-sm" : "min-h-[26px] text-xs",
              checked && variant === "subtle" && "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.18)]",
              checked && variant === "solid" && "bg-accent font-medium text-on-accent",
              !checked && "text-ink-muted hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
