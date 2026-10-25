"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { useApi } from "@/hooks/useApi";
import type { ApiPage } from "@/lib/api-client";
import { clampPage, usePageState, type Pager } from "@/components/list/usePager";

/** The SWR key of one page of a history feed: the feed's path, then limit,
 * offset and any filters. useRealtime revalidates every key under the path. */
export function pageKey(path: string, page: number, pageSize: number, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `${path}?${q}`;
}

/** A history feed paged by the API (commands, firings, versions, failed
 * deliveries): asks for one page, reads the total from X-Total-Count, and goes
 * back to page 1 when the filters change. Keeps the previous page on screen
 * while the next one loads. */
export function useServerPager<T>(
  path: string | null,
  { params = {}, config }: { params?: Record<string, string | null | undefined>; config?: SWRConfiguration<ApiPage<T>> } = {},
): Pager & { rows: T[]; total: number; isLoading: boolean; error: unknown; mutate: () => Promise<unknown> } {
  const api = useApi();
  const filters = JSON.stringify(params);
  const state = usePageState(filters);
  const key = path ? pageKey(path, state.page, state.pageSize, params) : null;
  const { data, error, isLoading, mutate } = useSWR<ApiPage<T>>(key, key ? () => api.getPage<T>(key) : null, {
    keepPreviousData: true,
    ...config,
  });
  const total = data?.total ?? 0;
  const { page, pageCount } = clampPage(state.page, total, state.pageSize);
  return { ...state, page, pageCount, rows: data?.items ?? [], total, isLoading, error, mutate };
}
