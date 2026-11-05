import useSWR, { type SWRConfiguration } from "swr";
import { useApi } from "./useApi";

/** useApi's GET through SWR's cache, keyed by path (the cache is per
 * workspace: see the (app) layout). */
export function useApiSWR<T>(path: string | null, config?: SWRConfiguration<T>) {
  const api = useApi();
  return useSWR<T>(path, path ? () => api.get<T>(path) : null, config);
}
