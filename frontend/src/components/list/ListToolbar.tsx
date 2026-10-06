"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

export interface QuickFilterOption {
  value: string;
  label: string;
  count?: number;
}

/** DESIGN.md §6 toolbar: search, filter controls, then (below) the active
 * filter chips. The search input debounces into the URL. */
export function ListToolbar({
  query,
  onQuery,
  placeholder,
  quick,
  children,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  /** Segmented quick filter with counts (All / Enabled / Disabled …). */
  quick?: { label: string; value: string; options: QuickFilterOption[]; onChange: (v: string) => void };
  /** Extra filter menus (selects), right-aligned. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(query);
  const sent = useRef(query);
  // Follow external changes only (chip removed, "Clear filters") — not the
  // echo of our own debounced write, which would clobber newer keystrokes.
  useEffect(() => {
    if (query !== sent.current) {
      sent.current = query;
      setText(query);
    }
  }, [query]);
  useEffect(() => {
    if (text === sent.current) return;
    const t = window.setTimeout(() => {
      sent.current = text;
      onQuery(text);
    }, 200);
    return () => window.clearTimeout(t);
  }, [text, onQuery]);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-0 flex-[1_1_220px] sm:max-w-[320px]">
        <Search aria-hidden size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="pl-8"
        />
      </div>
      {quick && (
        <div role="group" aria-label={quick.label} className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
          {quick.options.map((o) => {
            const on = quick.value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => quick.onChange(o.value)}
                className={cn(
                  "inline-flex min-h-[30px] items-center gap-1.5 rounded-[6px] px-3 text-[13px] transition-colors duration-150",
                  on ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.18)]" : "text-ink-muted hover:text-ink",
                )}
              >
                {o.label}
                {o.count != null && (
                  <span className={cn("text-xs tabular-nums", on ? "text-accent-strong" : "text-ink-muted")}>{o.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {children && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{children}</div>}
    </div>
  );
}

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Active-filter chips with a "Clear all" action. Renders nothing when empty. */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised py-0.5 pl-2.5 pr-1 text-xs text-ink"
        >
          {c.label}
          <button
            type="button"
            onClick={c.onRemove}
            aria-label={`Remove filter ${c.label}`}
            className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-border hover:text-ink"
          >
            <X aria-hidden size={12} />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="ml-1 text-sm text-accent hover:underline">
        Clear all
      </button>
    </div>
  );
}

/** Bulk actions for the selected rows. */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/35 bg-accent-muted px-3 py-2 text-sm"
    >
      <strong className="mr-1.5 font-semibold text-ink">{count} selected</strong>
      {children}
      <button type="button" onClick={onClear} className="text-sm text-accent hover:underline">
        Clear selection
      </button>
    </div>
  );
}
