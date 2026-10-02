"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A list's read-only peek (DESIGN.md §7): `?peek=<id>` beside the list.
 * Looking happens in the peek; changing happens on the record's page.
 *
 * - Row click peeks; Enter on the peeked row opens its page.
 * - While a peek is open, ↑/↓ move it (and focus) to the next/previous row.
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
  const peekId = params.get("peek");

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
  const legacyEdit = params.get("edit");
  useEffect(() => {
    if (!legacyEdit) return;
    if (legacyEdit === "new") {
      if (newHref) router.replace(newHref);
    } else {
      router.replace(pageHref(legacyEdit));
    }
  }, [legacyEdit, newHref, pageHref, router]);

  const onRowClick = useCallback((row: T) => setPeek(rowKey(row)), [rowKey, setPeek]);
  const onRowEnter = useCallback(
    (row: T) => {
      const id = rowKey(row);
      if (id === peekId) router.push(pageHref(id));
      else setPeek(id);
    },
    [rowKey, peekId, pageHref, router, setPeek],
  );

  // ↑/↓ walk the peek through the shown rows.
  useEffect(() => {
    if (!peekId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox'], [role='dialog'], [role='alertdialog']")) return;
      const i = rows.findIndex((r) => rowKey(r) === peekId);
      if (i < 0) return;
      const next = rows[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (!next) return;
      e.preventDefault();
      const id = rowKey(next);
      setPeek(id);
      document.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [peekId, rows, rowKey, setPeek]);

  return { peekId: legacyEdit ? null : peekId, setPeek, close: () => setPeek(null), onRowClick, onRowEnter };
}
