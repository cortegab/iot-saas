"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PeekNav } from "./peek-nav";

const rowFor = (id: string) => document.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(id)}"]`);

/**
 * A list's read-only peek (DESIGN.md §7): `?peek=<id>`, shown in a drawer over
 * the list (ListWithPeek). Looking happens in the peek; changing happens on
 * the record's page.
 *
 * - Row click peeks; Enter on the peeked row opens its page.
 * - The drawer blocks the list, so browsing happens inside it: `nav` drives
 *   its ‹ › buttons, and ↑/↓ move it while focus is in the drawer. The row
 *   follows along behind the scrim.
 * - Closing returns focus to the row of the record last shown.
 * - Old `?edit=new` / `?edit=<id>` links go to the new/record page.
 */
export function usePeek<T>({
  rows,
  rowKey,
  pageHref,
  newHref,
}: {
  /** The rows currently shown, in display order. */
  rows: T[];
  rowKey: (row: T) => string;
  /** Where a record is edited or opened. */
  pageHref: (id: string) => string;
  /** Where a new record is created. */
  newHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const legacyEdit = params.get("edit");
  const peekId = legacyEdit ? null : params.get("peek");

  const setPeek = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("peek", id);
      else next.delete("peek");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Old deep links from the docked-editor era.
  useEffect(() => {
    if (!legacyEdit) return;
    if (legacyEdit === "new") {
      if (newHref) router.replace(newHref);
    } else {
      router.replace(pageHref(legacyEdit));
    }
  }, [legacyEdit, newHref, pageHref, router]);

  const close = useCallback(() => {
    const last = peekId;
    setPeek(null);
    // After the drawer has returned focus to its trigger, land on the row
    // the user browsed to.
    if (last) window.setTimeout(() => rowFor(last)?.focus({ preventScroll: true }), 60);
  }, [peekId, setPeek]);

  const onRowClick = useCallback((row: T) => setPeek(rowKey(row)), [rowKey, setPeek]);
  const onRowEnter = useCallback(
    (row: T) => {
      const id = rowKey(row);
      if (id === peekId) router.push(pageHref(id));
      else setPeek(id);
    },
    [rowKey, peekId, pageHref, router, setPeek],
  );

  const index = peekId ? rows.findIndex((r) => rowKey(r) === peekId) : -1;
  const move = useCallback(
    (to: number) => {
      const row = rows[to];
      if (!row) return;
      const id = rowKey(row);
      setPeek(id);
      rowFor(id)?.scrollIntoView({ block: "nearest" });
    },
    [rows, rowKey, setPeek],
  );

  const nav = useMemo<PeekNav | null>(
    () =>
      peekId
        ? {
            index,
            total: rows.length,
            prev: index > 0 ? () => move(index - 1) : null,
            next: index >= 0 && index < rows.length - 1 ? () => move(index + 1) : null,
          }
        : null,
    [peekId, index, rows.length, move],
  );

  // ↑/↓ inside the drawer walk the peek through the shown rows.
  useEffect(() => {
    if (!nav) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest("[data-peek]")) return;
      if (t.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox'], [role='alertdialog']")) return;
      const go = e.key === "ArrowDown" ? nav!.next : nav!.prev;
      if (!go) return;
      e.preventDefault();
      go();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nav]);

  return { peekId, setPeek, close, onRowClick, onRowEnter, nav };
}
