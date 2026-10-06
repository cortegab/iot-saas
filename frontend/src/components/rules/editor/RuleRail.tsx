"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { RULE_SECTIONS, type RuleSection, type SectionIssue } from "@/lib/rule-preview";

/** The rule editor's section rail (DESIGN.md §9.2), as on the template page:
 * When · If · Then · Behaviour · Name, each with its state — a red count of
 * issues that block saving, an amber "!" for safety warnings, a ✓ once a new
 * rule's section is complete. Picking one scrolls to it in Form and selects
 * it on the rung in Ladder. Below 1200 px it becomes a row of chips. */
export function RuleRail({
  issues,
  isNew,
  active,
  onPick,
  className,
}: {
  issues: SectionIssue[];
  isNew: boolean;
  active: RuleSection | null;
  onPick: (s: RuleSection) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Rule sections" className={cn("flex gap-1 overflow-x-auto [scrollbar-width:none] wb:sticky wb:top-4 wb:flex-col wb:gap-0.5 wb:overflow-visible", className)}>
      <p className="hidden px-2.5 pb-1 text-xs font-semibold text-ink-muted wb:block">{isNew ? "New rule" : "Sections"}</p>
      {RULE_SECTIONS.map((s, i) => {
        const mine = issues.filter((x) => x.section === s.id);
        const blocking = mine.filter((x) => x.blocking).length;
        const warn = mine.length - blocking;
        const on = active === s.id;
        const state = blocking ? `${blocking} to fix` : warn ? `${warn} warning${warn === 1 ? "" : "s"}` : isNew ? "complete" : "";
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on || undefined}
            aria-label={state ? `${s.label}: ${state}` : s.label}
            onClick={() => onPick(s.id)}
            className={cn(
              "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-3 text-left wb:items-start wb:rounded-md wb:p-2.5",
              on ? "bg-surface shadow-[0_0_0_1px_var(--color-border),var(--shadow-card)]" : "hover:bg-surface-raised",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-semibold",
                blocking
                  ? "border-status-error bg-status-error text-on-accent"
                  : warn
                    ? "border-status-pending bg-status-pending-surface text-status-pending"
                    : isNew
                      ? "border-status-online bg-status-online text-on-accent"
                      : "border-border bg-surface text-ink-muted",
              )}
            >
              {blocking ? blocking : warn ? "!" : isNew ? <Check size={13} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <strong className={cn("text-sm font-medium", on ? "text-accent-strong" : "text-ink")}>
                {s.label}
              </strong>
              <small className="hidden text-[12.5px] text-ink-muted wb:block">{s.sub}</small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
