"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Badge, type DotShape, type StatusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";

export interface QuickFilterOption {
  value: string;
  label: string;
  count?: number;
  /** Status dot before the label (status is never colour alone: the label says it). */
  tone?: StatusTone;
  shape?: DotShape;
  /** What the state means ("waiting for first message"); the hover title. */
  hint?: string;
  /** A state that needs someone (offline, latched): its count turns red when not zero. */
  alert?: boolean;
}

/** DESIGN.md §6 toolbar. Row 1: search, filter menus, the view switch and the
 * page's primary action at the end. Row 2: the status filter with a count
 * per state (it replaces the KPI strip on list pages). The search input
 * debounces into the URL. Below 960 px the filter menus move into a **Filters**
 * bottom sheet, so the primary action stays in row 1; on phones the status
 * filter also becomes a select. */
export function ListToolbar({
  query,
  onQuery,
  placeholder,
  quick,
  activeFilters = 0,
  view,
  actions,
  searchable = true,
  children,
}: {
  /** A view switch (List / Ladder); stays in the toolbar on phones. */
  view?: ReactNode;
  /** The page's primary action ("Add device"), last in the first row. */
  actions?: ReactNode;
  /** False hides the search, for a state whose rows can't be searched. */
  searchable?: boolean;
  /** How many filters are on, for the phone's Filters button. */
  activeFilters?: number;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  /** Status filter with counts (All / Online / Offline …), on its own row. */
  quick?: { label: string; value: string; options: QuickFilterOption[]; onChange: (v: string) => void };
  /** Filter menus (selects), after the search. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(query);
  const sent = useRef(query);
  const phone = useMediaQuery("(max-width: 640px)");
  // Below ~960 px the filter menus would push the primary action onto its own
  // row (DESIGN.md §12), so they fold into one Filters button there too.
  const compact = useMediaQuery("(max-width: 960px)");
  const [sheetOpen, setSheetOpen] = useState(false);
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {searchable && (
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
        )}
        {children &&
          (compact ? (
            <>
              <Button variant="secondary" onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
                <ListFilter aria-hidden size={14} />
                Filters
                {activeFilters > 0 && <span className="text-xs tabular-nums text-accent-strong">{activeFilters}</span>}
              </Button>
              <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Filters" side="bottom">
                <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3">
                  <h2 className="text-section font-semibold text-ink">Filters</h2>
                  <div className="flex flex-col gap-3 [&>*]:w-full">{children}</div>
                  <Button onClick={() => setSheetOpen(false)}>Done</Button>
                </div>
              </Sheet>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">{children}</div>
          ))}
        {view}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {quick &&
        (phone ? (
          <Select aria-label={quick.label} value={quick.value} onChange={(e) => quick.onChange(e.target.value)}>
            {quick.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.count != null ? `${o.label} (${o.count})` : o.label}
              </option>
            ))}
          </Select>
        ) : (
          <div role="group" aria-label={quick.label} className="inline-flex flex-wrap gap-0.5 self-start rounded-md border border-border bg-surface-raised p-0.5">
            {quick.options.map((o) => {
              const on = quick.value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  title={o.hint}
                  onClick={() => quick.onChange(o.value)}
                  className={cn(
                    "inline-flex min-h-[30px] pointer-coarse:min-h-[38px] items-center gap-[7px] rounded-[6px] px-3 text-meta transition-colors duration-150",
                    on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.18)]" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {o.tone && <Badge tone={o.tone} shape={o.shape} label={o.label} variant="indicator" />}
                  {o.label}
                  {o.count != null && (
                    <span className={cn("font-semibold tabular-nums", o.alert && o.count > 0 ? "text-status-offline" : "text-ink")}>{o.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
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
