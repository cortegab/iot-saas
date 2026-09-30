"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  className?: string;
}

/** DESIGN.md §5 Switch — a binary *state* ("is it on"), e.g. rule
 * Enabled/Disabled. Use a checkbox only for picking items in a list. */
export function Switch({
  checked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  disabled,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-[42px] shrink-0 rounded-full border p-0 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-border bg-surface-raised",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-[transform,background-color] duration-150",
          checked ? "translate-x-[18px] bg-on-accent" : "bg-ink-muted",
        )}
      />
    </button>
  );
}

/** A Switch beside its state word with a hint line below (DESIGN.md §9.7
 * Status row): "Enabled — Fires when its trigger and conditions are met." */
export function SwitchField({
  label,
  checked,
  onChange,
  onLabel,
  offLabel,
  onHint,
  offHint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onLabel: string;
  offLabel: string;
  onHint?: ReactNode;
  offHint?: ReactNode;
  disabled?: boolean;
}) {
  const labelId = useId();
  const hintId = useId();
  const hint = checked ? onHint : offHint;
  return (
    <div className="flex flex-col gap-[5px]">
      <span id={labelId} className="text-xs font-medium text-ink-muted">
        {label}
      </span>
      <div className="flex min-h-control items-center gap-3">
        <Switch
          checked={checked}
          onChange={onChange}
          ariaLabelledBy={labelId}
          ariaDescribedBy={hint ? hintId : undefined}
          disabled={disabled}
        />
        <span className="text-sm font-medium text-ink">{checked ? onLabel : offLabel}</span>
      </div>
      {hint && (
        <span id={hintId} className="text-xs text-ink-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
