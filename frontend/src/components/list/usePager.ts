"use client";

import { useEffect, useState } from "react";
import { PAGE_SIZES } from "@/components/list/useListState";

/** Page math shared by both pagers: the page kept inside 1..pageCount. */
export function clampPage(page: number, total: number, pageSize: number): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), pageCount), pageCount };
}

/** The numbered pager's slots (DESIGN.md §6): the first and last page, the
 * current one and its neighbours, "…" between. Always seven slots once there
 * are more than seven pages, so the buttons don't jump as you move. */
export function pageItems(page: number, pageCount: number): (number | "…")[] {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  if (pageCount <= 7) return range(1, pageCount);
  if (page <= 4) return [...range(1, 5), "…", pageCount];
  if (page >= pageCount - 3) return [1, "…", ...range(pageCount - 4, pageCount)];
  return [1, "…", page - 1, page, page + 1, "…", pageCount];
}

export interface Pager {
  page: number;
  pageCount: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/** Page state kept in the component, not the URL: two lists on one page (a
 * device's timeline and its rules) each keep their own. Back to page 1 when
 * `resetOn` changes (a filter) or the page size does. */
export function usePageState(resetOn = "", initialSize: number = PAGE_SIZES[0]) {
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(initialSize);
  useEffect(() => setPage(1), [resetOn]);
  const setPageSize = (size: number) => {
    setSize(size);
    setPage(1);
  };
  return { page, pageSize, setPage, setPageSize };
}

/** A list paged in the browser (DESIGN.md §6): every row is already here, this
 * shows one page of them. For short bounded lists the footer shows no pager. */
export function usePager<T>(rows: T[], resetOn = ""): Pager & { pageRows: T[] } {
  const state = usePageState(resetOn);
  const { page, pageCount } = clampPage(state.page, rows.length, state.pageSize);
  return {
    ...state,
    page,
    pageCount,
    pageRows: rows.slice((page - 1) * state.pageSize, page * state.pageSize),
  };
}
