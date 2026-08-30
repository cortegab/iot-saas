"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const DEFAULT_TRIGGER_CLASSNAME =
  "rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
  panelClassName = "w-48 p-1",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              ref={panelRef}
              role={children ? undefined : "menu"}
              tabIndex={-1}
              style={align === "start" ? { top: coords.top, left: coords.left } : { top: coords.top, right: coords.right }}
              className={cn("fixed z-50 rounded-xl border border-border bg-surface shadow-lg", panelClassName)}
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
                          "flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-150 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          item.danger
                            ? "text-status-error hover:bg-status-error-surface"
                            : "text-ink hover:bg-surface-raised",
                        )}
                      >
                        {item.label}
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
