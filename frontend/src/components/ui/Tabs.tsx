"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
  /** Small count beside the label; `alert` renders it in the error tint. */
  count?: number;
  alert?: boolean;
  disabled?: boolean;
  /** Shown as a native title tooltip on hover when `disabled`. */
  disabledReason?: string;
}

/** Controlled underline tab strip (DESIGN.md §5 Tabs). The caller owns the
 * active tab (often mirrored into a query param) and renders the panels. Tabs
 * wrap onto a second line rather than ever showing a horizontal scrollbar. */
export function Tabs({
  tabs,
  active,
  onChange,
  ariaLabel = "Sections",
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => {
        const selected = !tab.disabled && tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            disabled={tab.disabled}
            aria-selected={selected}
            aria-disabled={tab.disabled || undefined}
            aria-controls={tab.disabled ? undefined : `tabpanel-${tab.id}`}
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
          </button>
        );
      })}
    </div>
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
