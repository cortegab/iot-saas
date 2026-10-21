"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface ChoiceOption<T extends string> {
  value: T;
  title: string;
  /** One line on what picking it means. */
  description: string;
  disabled?: boolean;
}

/** DESIGN.md §5 radio cards: a choice between a few options that each need a
 * line of explanation (how to start Add device, Runs on). Two across, one
 * across from 560px down. A radiogroup: arrow keys move and select. */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  // Nothing picked yet: the first card takes the group's tab stop.
  const tabStop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || enabled.length === 0) return;
    e.preventDefault();
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + step + enabled.length) % enabled.length];
    onChange(next.value);
    ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  }

  return (
    <div className={cn("@container", className)}>
      <div ref={ref} role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown} className="grid grid-cols-2 gap-3 @max-[560px]:grid-cols-1">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={o.value}
              disabled={o.disabled}
              tabIndex={o.value === tabStop ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-surface px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                on ? "border-accent bg-accent-muted" : "border-border hover:border-ink-muted",
              )}
            >
              <span
                aria-hidden
                className={cn("mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px]", on ? "border-[5px] border-accent" : "border-ink-muted")}
              />
              <span className="flex flex-col gap-0.5">
                <b className="text-sm font-semibold text-ink">{o.title}</b>
                <span className="text-[12.5px] text-ink-muted">{o.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
