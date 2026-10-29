/**
 * The one save bar (DESIGN.md §7, demo H): always at the bottom of the window,
 * on short pages too. A page that owns a bar puts PAGE_WITH_BAR on its root —
 * it grows to fill <main> (which fills the window) and cancels main's bottom
 * padding — and SAVE_BAR on the bar, which sits last (mt-auto) and sticks above
 * the phone tab bar. Give the bar `data-savebar` so toasts rise above it.
 *
 * One bar everywhere (DESIGN.md §7): full content width, one height. At
 * ≤ 480 px the status line takes its own row and the buttons share the width
 * (the bar's direct `button` / `a` children and any button group grow). While
 * a bar is shown on a phone the tab bar hides (globals.css), so the bar sits
 * at the window bottom.
 */
export const PAGE_WITH_BAR = "flex flex-1 flex-col -mb-[110px]";

export const SAVE_BAR =
  "sticky bottom-[var(--tabbar-h)] z-[6] mt-auto -mx-4 flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border bg-surface/92 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] backdrop-blur-[10px] rail:-mx-10 rail:px-10" +
  " max-[480px]:[&>*:first-child]:basis-full max-[480px]:[&>:is(a,button,div):not(:first-child)]:flex-1 max-[480px]:[&>div:not(:first-child)>*]:flex-1";

/** A create page that isn't on EditorFrame (Add device, Connect): its content
 * keeps the 760 px editor column while the bar, a direct child, spans the
 * page like every other bar. */
export const EDITOR_COLUMN = "[&>*:not([data-savebar])]:max-w-[760px]";
