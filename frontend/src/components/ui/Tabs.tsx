"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
  /** Small count beside the label; `alert` renders it in the error tint. */
  count?: number;
  alert?: boolean;
  /** Editor tabs (DESIGN.md §5): problems in this tab that block saving (a
   * red count) and safety warnings (an amber "!", never blocks). */
  issues?: number;
  warn?: boolean;
  disabled?: boolean;
  /** Shown as a native title tooltip on hover when `disabled`. */
  disabledReason?: string;
}

/** Controlled underline tab strip (DESIGN.md §5 Tabs). The caller owns the
 * active tab (often mirrored into a query param) and renders the panels. Tabs
 * wrap onto a second line rather than ever showing a horizontal scrollbar.
 * Arrow keys, Home and End move between tabs and select them. */
export function Tabs({
  tabs,
  active,
  onChange,
  ariaLabel = "Sections",
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((t) => !t.disabled);
  const current = enabled.some((t) => t.id === active) ? active : enabled[0]?.id;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = enabled.findIndex((t) => t.id === current);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0 || !enabled[next]) return;
    e.preventDefault();
    const id = enabled[next].id;
    onChange(id);
    listRef.current?.querySelector<HTMLElement>(`#tab-${CSS.escape(id)}`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("flex flex-wrap gap-x-1 border-b border-border", className)}
    >
      {tabs.map((tab) => {
        const selected = !tab.disabled && tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            disabled={tab.disabled}
            aria-selected={selected}
            aria-disabled={tab.disabled || undefined}
            aria-controls={tab.disabled ? undefined : `tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            title={tab.disabled ? tab.disabledReason : undefined}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm transition-colors duration-150",
              "after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full",
              selected && "font-medium text-ink after:bg-accent",
              !selected && !tab.disabled && "text-ink-muted hover:text-ink",
              tab.disabled && "cursor-not-allowed text-ink-muted/50",
            )}
          >
            {tab.label}
            {tab.count != null && (
              <span
                className={cn(
                  "rounded-full px-[7px] text-xs",
                  tab.alert
                    ? "bg-status-error-surface font-semibold text-status-error"
                    : "bg-surface-raised font-normal text-ink-muted",
                )}
              >
                {tab.count}
              </span>
            )}
            <IssueMarks issues={tab.issues} warn={tab.warn} />
          </button>
        );
      })}
    </div>
  );
}

/** The red "N to fix" count and the amber "!" used on tabs, steps and rows
 * (DESIGN.md §9.2: red only for what blocks saving). */
export function IssueMarks({ issues = 0, warn = false }: { issues?: number; warn?: boolean }) {
  return (
    <>
      {issues > 0 && (
        <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-status-error px-[5px] text-[10.5px] font-bold text-on-accent">
          {issues}
          <span className="sr-only"> to fix</span>
        </span>
      )}
      {issues === 0 && warn && (
        <span className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-status-pending bg-status-pending-surface text-[10px] font-bold text-status-pending">
          !<span className="sr-only"> warning</span>
        </span>
      )}
    </>
  );
}

/** A tab's panel. `keepMounted` keeps inactive panels in the DOM (hidden) so
 * their form fields still validate and keep state — use it for any tabbed
 * form. */
export function TabPanel({
  id,
  active,
  keepMounted = false,
  children,
}: {
  id: string;
  active: string;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const isActive = id === active;
  if (!isActive && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={!isActive}
      className="flex flex-col gap-4 pt-4"
    >
      {children}
    </div>
  );
}
