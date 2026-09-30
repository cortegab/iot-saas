"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type SortDir = "asc" | "desc";

export interface ListState<F extends string> {
  q: string;
  filters: Record<F, string>;
  sort: { key: string; dir: SortDir } | null;
  page: number;
  pageSize: number;
}

export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * List-page state mirrored into the URL (DESIGN.md §7 "deep links: every
 * record and every editor state has a URL"): `?q=`, one param per filter,
 * `?sort=key:asc`, `?page=`, `?size=`. Defaults are omitted from the URL.
 */
export function useListState<F extends string>(
  defaults: Record<F, string>,
  defaultSort: { key: string; dir: SortDir } | null = null,
) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state = useMemo<ListState<F>>(() => {
    const filters = { ...defaults };
    for (const k of Object.keys(defaults) as F[]) {
      const v = params.get(k);
      if (v != null) filters[k] = v;
    }
    const sortRaw = params.get("sort");
    let sort = defaultSort;
    if (sortRaw) {
      const [key, dir] = sortRaw.split(":");
      if (key) sort = { key, dir: dir === "desc" ? "desc" : "asc" };
    }
    const size = Number(params.get("size"));
    return {
      q: params.get("q") ?? "",
      filters,
      sort,
      page: Math.max(1, Number(params.get("page")) || 1),
      pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZES[0],
    };
    // `defaults`/`defaultSort` are literals at the call site; the URL is the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const write = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const setQuery = useCallback((q: string) => write({ q: q || null }), [write]);

  const setFilter = useCallback(
    (key: F, value: string) => write({ [key]: value === defaults[key] ? null : value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write],
  );

  const toggleSort = useCallback(
    (key: string) => {
      const cur = state.sort;
      const dir: SortDir = cur && cur.key === key && cur.dir === "asc" ? "desc" : "asc";
      const isDefault = defaultSort && defaultSort.key === key && defaultSort.dir === dir;
      write({ sort: isDefault ? null : `${key}:${dir}` }, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.sort, write],
  );

  const clearAll = useCallback(() => {
    const patch: Record<string, null> = { q: null };
    for (const k of Object.keys(defaults)) patch[k] = null;
    write(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [write]);

  const setPage = useCallback((page: number) => write({ page: page > 1 ? String(page) : null }, false), [write]);
  const setPageSize = useCallback(
    (size: number) => write({ size: size === PAGE_SIZES[0] ? null : String(size) }),
    [write],
  );

  const isFiltered =
    state.q.trim() !== "" || (Object.keys(defaults) as F[]).some((k) => state.filters[k] !== defaults[k]);

  return { ...state, isFiltered, setQuery, setFilter, toggleSort, clearAll, setPage, setPageSize };
}

/** Case-insensitive "every word appears somewhere in the haystack". */
export function matchesQuery(q: string, ...haystack: (string | null | undefined)[]): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Rows for the current page, and the page count (the page is clamped). */
export function paginate<T>(rows: T[], page: number, pageSize: number): { pageRows: T[]; pageCount: number; page: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { pageRows: rows.slice((p - 1) * pageSize, p * pageSize), pageCount, page: p };
}

/** Stable sort by a key extractor; `null`/`undefined` sort last. */
export function sortRows<T>(
  rows: T[],
  sort: { key: string; dir: SortDir } | null,
  value: (row: T, key: string) => string | number | null | undefined,
): T[] {
  if (!sort) return rows;
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * mul;
  });
}
