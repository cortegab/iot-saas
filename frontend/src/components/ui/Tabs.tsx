"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
 * never wrap: when they don't fit (phones) the row scrolls sideways with no
 * visible scrollbar, fades at the edge that has more, and keeps the active tab
 * in view. Arrow keys, Home and End move between tabs and select them. */
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
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Keep the active tab in view (scrolling the strip only, never the page).
  useEffect(() => {
    const el = listRef.current;
    const tab = current ? el?.querySelector<HTMLElement>(`#tab-${CSS.escape(current)}`) : null;
    if (!el || !tab) return;
    const pad = 24;
    if (tab.offsetLeft - pad < el.scrollLeft) el.scrollLeft = tab.offsetLeft - pad;
    else if (tab.offsetLeft + tab.offsetWidth + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = tab.offsetLeft + tab.offsetWidth + pad - el.clientWidth;
  }, [current]);

  const fade = `linear-gradient(to right, ${more.left ? "transparent, #000 28px" : "#000"}, ${more.right ? "#000 calc(100% - 28px), transparent" : "#000"})`;

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
    <div className={cn("border-b border-border", className)}>
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onScroll={measure}
      style={more.left || more.right ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      className="-mb-px flex gap-x-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            // Only the shown panel is guaranteed to be in the page (editors render
            // just the active one), so only the selected tab names it.
            aria-controls={selected ? `tabpanel-${tab.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            title={tab.disabled ? tab.disabledReason : undefined}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative inline-flex h-control shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm transition-colors duration-150",
              "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full",
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
    </div>
  );
}

/** The red "N to fix" count and the amber "!" used on tabs, steps and rows
 * (DESIGN.md §9.2: red only for what blocks saving). */
export function IssueMarks({ issues = 0, warn = false }: { issues?: number; warn?: boolean }) {
  return (
    <>
      {issues > 0 && (
        <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-status-error px-[5px] text-xs font-bold text-on-accent">
          {issues}
          <span className="sr-only"> to fix</span>
        </span>
      )}
      {issues === 0 && warn && (
        <span className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-status-pending bg-status-pending-surface text-xs font-bold text-status-pending">
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
  className,
  children,
}: {
  id: string;
  active: string;
  keepMounted?: boolean;
  className?: string;
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
      className={cn("flex flex-col gap-4 pt-4", className)}
    >
      {children}
    </div>
  );
}
