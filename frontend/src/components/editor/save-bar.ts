/**
 * The one save bar (DESIGN.md §7, demo H): always at the bottom of the window,
 * on short pages too. A page that owns a bar puts PAGE_WITH_BAR on its root —
 * it grows to fill <main> (which fills the window) and cancels main's bottom
 * padding — and SAVE_BAR on the bar, which sits last (mt-auto) and sticks above
 * the phone tab bar. Give the bar `data-savebar` so toasts rise above it.
 */
export const PAGE_WITH_BAR = "flex flex-1 flex-col -mb-[110px]";

export const SAVE_BAR =
  "sticky bottom-[var(--tabbar-h)] z-[6] mt-auto -mx-4 flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border bg-surface/92 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] backdrop-blur-[10px] max-rail:pb-3 rail:-mx-10 rail:px-10";
