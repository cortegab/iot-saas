"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** `subtle` (default) — a pill group that reads as chrome (action-type
   * tabs, AND/OR). `solid` — the selected segment fills with the accent, for
   * a control that IS the value being set (a boolean actuator command). */
  variant?: "subtle" | "solid";
  className?: string;
}

const BUTTON_BASE =
  "rounded-md px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const VARIANT = {
  subtle: {
    active: "border border-border bg-surface-raised text-ink shadow-sm",
    inactive: "text-ink-muted hover:text-ink",
  },
  solid: {
    active: "bg-accent font-medium text-on-accent",
    inactive: "text-ink-muted hover:text-ink",
  },
} as const;

/** A row of mutually exclusive buttons — the app's one segmented control,
 * factored out of the two copies that lived in `RuleForm`. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "subtle",
  className,
}: SegmentedControlProps<T>) {
  const styles = VARIANT[variant];
  return (
    <div role="group" aria-label={ariaLabel} className={cn("inline-flex gap-1 rounded-lg bg-canvas p-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(BUTTON_BASE, value === opt.value ? styles.active : styles.inactive)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
