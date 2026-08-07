"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { useApi } from "@/hooks/useApi";

/** Thin binding of useApi (tenant-scoped, retry-on-401 fetch) into SWR's
 * cache/revalidation — the swr dependency Stage 1 installed for exactly this. */
export function useApiSWR<T>(path: string | null, config?: SWRConfiguration<T>) {
  const api = useApi();
  return useSWR<T>(path, path ? () => api.get<T>(path) : null, config);
}
