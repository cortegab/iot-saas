"use client";

import { useCallback, useMemo } from "react";
import { mutate } from "swr";
import { apiClient, ApiRequestError, type ApiClientContext } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Fire-and-forget revalidation of every cached GET after any successful write.
 * A create/edit/delete can touch data on screens far from the one that issued
 * it (a template rename shows on the device page, a deleted device drops out of
 * dashboards, a new rule changes the chart's threshold lines), and hand-listing
 * every affected key at each call site is what leaves sections stale until a
 * manual refresh. Blanket revalidation is cheap at this app's scale — SWR
 * dedupes, and only mounted keys refetch immediately.
 *
 * Telemetry history/latest keys are excluded: they can be large and already
 * stay fresh via useRealtime + their own refreshInterval, so a write shouldn't
 * trigger a burst of range re-fetches.
 */
function revalidateAfterWrite(): void {
  void mutate(
    (key) =>
      typeof key === "string" && !key.includes("/data?metric=") && !key.endsWith("/latest"),
  );
}

/**
 * Tenant-scoped API access for authenticated screens. Wraps api-client.ts (which
 * stays context-free) with the current session's token/tenant and a single
 * retry-on-401: a request that fails because the access token expired mid-session
 * transparently re-authenticates from the stored refresh token and retries once,
 * rather than surfacing a spurious error to a still-logged-in user.
 */
export function useApi() {
  const { accessToken, currentTenantId, refresh } = useAuth();

  const withRetry = useCallback(
    async <T,>(fn: (ctx: ApiClientContext) => Promise<T>): Promise<T> => {
      try {
        return await fn({ accessToken, tenantId: currentTenantId });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          const refreshed = await refresh();
          if (refreshed) {
            return await fn({ accessToken: refreshed.access_token, tenantId: currentTenantId });
          }
        }
        throw err;
      }
    },
    [accessToken, currentTenantId, refresh],
  );

  return useMemo(() => {
    // Kick off a blanket revalidation once the write resolves, then hand the
    // caller back its result unchanged.
    const afterWrite = <T,>(result: T): T => {
      revalidateAfterWrite();
      return result;
    };
    return {
      get: <T,>(path: string) => withRetry<T>((ctx) => apiClient.get<T>(path, ctx)),
      post: <T,>(path: string, body?: Record<string, unknown>) =>
        withRetry<T>((ctx) => apiClient.post<T>(path, ctx, body)).then(afterWrite),
      patch: <T,>(path: string, body?: Record<string, unknown>) =>
        withRetry<T>((ctx) => apiClient.patch<T>(path, ctx, body)).then(afterWrite),
      delete: <T,>(path: string) =>
        withRetry<T>((ctx) => apiClient.delete<T>(path, ctx)).then(afterWrite),
    };
  }, [withRetry]);
}
