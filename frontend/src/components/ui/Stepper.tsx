"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface StepItem {
  id: string;
  label: string;
  /** Problems shown in this step: its number turns red. */
  issues?: number;
}

/** DESIGN.md §5 Wizard steps: numbered (done ✓ / current / red when a step
 * has problems); "Step n of N" over a progress bar when its container is
 * 640px or narrower. Put it inside an `@container`. */
export function Stepper({
  steps,
  current,
  onPick,
  canPick = () => true,
}: {
  steps: StepItem[];
  current: number;
  /** Makes each step a button that goes to it (Connect: skip to Live check). */
  onPick?: (index: number) => void;
  canPick?: (index: number) => boolean;
}) {
  const now = steps[current];
  const wrap = (i: number, body: ReactNode) =>
    onPick ? (
      <button
        type="button"
        disabled={!canPick(i)}
        onClick={() => onPick(i)}
        className="flex min-h-[30px] items-center gap-2 rounded-md hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {body}
      </button>
    ) : (
      body
    );
  return (
    <>
      <ol aria-label="Steps" className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 @max-[640px]:hidden">
        {steps.map((s, i) => {
          const done = i < current;
          const isNow = i === current;
          const bad = (s.issues ?? 0) > 0;
          return (
            <li
              key={s.id}
              aria-current={isNow ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-meta",
                isNow ? "font-medium text-ink" : "text-ink-muted",
                i < steps.length - 1 && "after:ml-1.5 after:mr-1 after:h-px after:w-8 after:bg-border",
              )}
            >
              {wrap(
                i,
                <>
              <span
                aria-hidden
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full border-[1.5px] text-xs font-semibold",
                  bad
                    ? "border-status-error text-status-error"
                    : done
                      ? "border-status-online bg-status-online text-on-accent"
                      : isNow
                        ? "border-accent bg-accent-muted text-accent-strong"
                        : "border-border",
                )}
              >
                {done && !bad ? <Check size={12} /> : i + 1}
              </span>
              {s.label}
              {done && !bad && <span className="sr-only">, done</span>}
              {bad && <span className="sr-only">, has problems</span>}
                </>,
              )}
            </li>
          );
        })}
      </ol>
      <div className="mb-2 hidden @max-[640px]:block">
        <p className="mb-1.5 text-meta text-ink-muted">
          Step{" "}
          <b className="text-ink">
            {current + 1} of {steps.length}
          </b>{" "}
          · {now?.label}
        </p>
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={current + 1}
          className="h-1 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </>
  );
}
