"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Leading icon (lucide, size 15). */
  icon?: ReactNode;
  /** Small second line, e.g. why an item is disabled. */
  hint?: string;
}

const DEFAULT_TRIGGER_CLASSNAME =
  "inline-grid h-[30px] w-[30px] place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink";

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/** Generic dropdown-panel shell: portals to `document.body` and positions
 * `fixed` from the trigger's own `getBoundingClientRect()` rather than
 * `absolute` in place — every "⋮" row-action caller lives inside a `Table`'s
 * `overflow-x-auto` wrapper, which clips an in-place absolute panel at the
 * table's edge (overflow-x: auto implicitly clips overflow-y too), and
 * fixed-position sidebar/header triggers (account menu, notifications) hit
 * the same clipping risk near viewport edges. `UserMenu` and
 * `NotificationBell` used to hand-roll this exact panel+click-catcher
 * mechanism independently; both now render through here — pass `trigger` +
 * `children` for a fully custom panel, or leave them unset for the default
 * "⋮" row-action menu driven by `groups`.
 */
export function DropdownMenu({
  groups,
  children,
  label = "Actions",
  trigger,
  triggerClassName = DEFAULT_TRIGGER_CLASSNAME,
  panelClassName = "min-w-[200px] p-1",
  align = "end",
}: {
  groups?: DropdownMenuItem[][];
  /** Fully custom panel content — takes precedence over `groups` when set. */
  children?: ReactNode;
  label?: string;
  /** Custom trigger content (e.g. an avatar circle or a bell icon). Falls
   * back to the "⋮" `MoreVertical` icon used by row-action menus. */
  trigger?: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  /** Which viewport edge the panel hangs from. `end` (default) anchors to
   * the trigger's right edge, matching every current caller. */
  align?: "end" | "start";
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords(
        align === "start"
          ? { top: rect.bottom + 4, left: rect.left, right: 0 }
          : { top: rect.bottom + 4, left: 0, right: window.innerWidth - rect.right },
      );
    }
    setOpen((o) => !o);
  }

  // The trigger — not the browser's default "wherever focus happened to be"
  // — is where focus belongs once the menu closes, since the panel is
  // portaled away from the trigger's position in the DOM.
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Keep the panel inside the viewport: flip above the trigger when there's no
  // room below (e.g. the account menu at the foot of the sidebar), and clamp
  // horizontally.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRef.current) return;
    const panel = panelRef.current.getBoundingClientRect();
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + panel.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - panel.height - 4);
    }
    setCoords((c) => {
      const next = { ...c, top };
      if (align === "start") {
        next.left = Math.max(margin, Math.min(c.left, window.innerWidth - panel.width - margin));
      } else {
        next.right = Math.max(margin, Math.min(c.right, window.innerWidth - panel.width - margin));
      }
      return next.top === c.top && next.left === c.left && next.right === c.right ? c : next;
    });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;

    // Move focus into the panel the instant it opens. Without this, Tab from
    // the trigger follows DOM order (the portal sits at the end of
    // `document.body`), not visual order, so it wouldn't reliably land here.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panelRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // Trap Tab/Shift+Tab inside the panel for the same reason focus is
      // moved in on open — without this, tabbing out lands on unrelated page
      // content instead of cycling back to the first/last item.
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup={children ? "dialog" : "menu"}
        aria-expanded={open}
        className={triggerClassName}
      >
        {trigger ?? <MoreVertical aria-hidden size={16} />}
      </button>

      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="fixed inset-0 z-[84] cursor-default"
            />
            <div
              ref={panelRef}
              role={children ? undefined : "menu"}
              tabIndex={-1}
              style={align === "start" ? { top: coords.top, left: coords.left } : { top: coords.top, right: coords.right }}
              // Custom panels close when any of their menu items is chosen.
              onClick={
                children
                  ? (e) => {
                      if ((e.target as HTMLElement).closest('[role^="menuitem"]')) close();
                    }
                  : undefined
              }
              className={cn("fixed z-[85] rounded-xl border border-border bg-pop shadow-pop", panelClassName)}
            >
              {children ??
                groups?.map((items, gi) => (
                  <div key={gi} className={gi > 0 ? "mt-1 border-t border-border pt-1" : undefined}>
                    {items.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => {
                          close();
                          item.onClick();
                        }}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-[9px] rounded-md px-2.5 py-[7px] text-left text-sm transition-colors duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                          item.danger
                            ? "text-status-error hover:bg-status-error-surface focus-visible:bg-status-error-surface"
                            : "text-ink hover:bg-surface-raised focus-visible:bg-surface-raised",
                        )}
                      >
                        {item.icon && (
                          <span aria-hidden className={cn("grid", item.danger ? "text-status-error" : "text-ink-muted")}>
                            {item.icon}
                          </span>
                        )}
                        {item.label}
                        {item.hint && (
                          <small className={cn("-mt-0.5 basis-full text-[11px] text-ink-muted", item.icon && "pl-6")}>
                            {item.hint}
                          </small>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
