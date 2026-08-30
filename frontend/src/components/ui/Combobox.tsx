"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text shown muted next to the label (e.g. the unit's full name). */
  hint?: string;
}

export interface ComboboxGroup {
  label: string;
  options: ComboboxOption[];
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  groups: ComboboxGroup[];
  /** Let the author commit a typed value that isn't in `groups` (Enter on a
   * non-empty search with no active option). Default false. */
  allowCustomValue?: boolean;
  placeholder?: string;
  /** Merged onto the trigger button — pass the sibling inputs' class string
   * so the control lines up with them. */
  className?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Caps the search box, and therefore a committed custom value. */
  maxLength?: number;
  /** Trigger display for the current value. Default: the matching option's
   * label, else the raw value. */
  renderValue?: (value: string) => string;
}

const PANEL_CLASS = "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg";

/** A select-only combobox with an inline filter (ARIA 1.2 "select-only
 * combobox" pattern). Borrows `DropdownMenu`'s portal + fixed-from-trigger-rect
 * positioning so it isn't clipped inside a `Table`/`overflow` ancestor, but
 * keeps DOM focus on the search input and tracks the active option with
 * `aria-activedescendant` rather than moving focus onto list items. */
export function Combobox({
  value,
  onChange,
  groups,
  allowCustomValue = false,
  placeholder,
  className,
  ariaLabel,
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  maxLength,
  renderValue,
}: ComboboxProps) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    const out: ComboboxGroup[] = [];
    for (const group of groups) {
      const options = group.options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.hint ?? "").toLowerCase().includes(q),
      );
      if (options.length > 0) out.push({ label: group.label, options });
    }
    return out;
  }, [groups, search]);

  const flatOptions = useMemo(() => filteredGroups.flatMap((g) => g.options), [filteredGroups]);

  const displayValue = useMemo(() => {
    if (!value) return "";
    if (renderValue) return renderValue(value);
    for (const group of groups) {
      const match = group.options.find((o) => o.value === value);
      if (match) return match.label;
    }
    return value;
  }, [value, renderValue, groups]);

  function openPanel() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setSearch("");
    const selected = flatOptionsForValue(groups, value);
    setActiveIndex(selected >= 0 ? selected : 0);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function commit(next: string) {
    onChange(next);
    closePanel();
  }

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flatOptions.length === 0 ? 0 : (i + 1) % flatOptions.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flatOptions.length === 0 ? 0 : (i - 1 + flatOptions.length) % flatOptions.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = flatOptions[activeIndex];
      if (active) commit(active.value);
      else if (allowCustomValue && search.trim()) commit(search.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    } else if (e.key === "Tab") {
      closePanel();
    }
  }

  let flatIndex = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closePanel() : openPanel())}
        className={cn(
          "flex items-center justify-between gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          className,
        )}
      >
        <span className={cn("truncate", !displayValue && "text-ink-muted")}>{displayValue || placeholder}</span>
        <ChevronsUpDown aria-hidden size={14} className="shrink-0 text-ink-muted" />
      </button>

      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close"
              onClick={closePanel}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              className={PANEL_CLASS}
              style={{ top: coords.top, left: coords.left, width: coords.width, minWidth: "16rem", maxHeight: "18rem" }}
            >
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded
                aria-controls={listboxId}
                aria-activedescendant={
                  flatOptions[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined
                }
                value={search}
                maxLength={maxLength}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={searchPlaceholder}
                className="border-b border-border bg-surface-raised px-3 py-2 text-sm text-ink focus:outline-none"
              />
              <ul id={listboxId} role="listbox" className="overflow-y-auto py-1">
                {flatOptions.length === 0 && (
                  <li className="px-3 py-2 text-sm text-ink-muted" role="presentation">
                    {allowCustomValue && search.trim()
                      ? `Press Enter to use “${search.trim()}”`
                      : emptyLabel}
                  </li>
                )}
                {filteredGroups.map((group) => (
                  <li key={group.label} role="presentation">
                    <p className="px-3 pb-0.5 pt-2 font-mono text-xs uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </p>
                    <ul role="presentation">
                      {group.options.map((option) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        const isActive = idx === activeIndex;
                        return (
                          <li
                            key={`${group.label}-${idx}`}
                            ref={isActive ? activeRef : undefined}
                            id={`${baseId}-opt-${idx}`}
                            role="option"
                            aria-selected={option.value === value}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              commit(option.value);
                            }}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm",
                              isActive ? "bg-surface-raised text-ink" : "text-ink-muted",
                            )}
                          >
                            <span className="font-mono text-ink">{option.label}</span>
                            {option.hint && <span className="truncate text-xs text-ink-muted">{option.hint}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** Index of `value` in the flattened option list, or -1. */
function flatOptionsForValue(groups: ComboboxGroup[], value: string): number {
  let i = -1;
  for (const group of groups) {
    for (const option of group.options) {
      i += 1;
      if (option.value === value) return i;
    }
  }
  return -1;
}
