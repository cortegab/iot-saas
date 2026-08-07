"use client";

import { useCallback, useMemo } from "react";
import { apiClient, ApiRequestError, type ApiClientContext } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";

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

  return useMemo(
    () => ({
      get: <T,>(path: string) => withRetry<T>((ctx) => apiClient.get<T>(path, ctx)),
      post: <T,>(path: string, body?: Record<string, unknown>) =>
        withRetry<T>((ctx) => apiClient.post<T>(path, ctx, body)),
      patch: <T,>(path: string, body?: Record<string, unknown>) =>
        withRetry<T>((ctx) => apiClient.patch<T>(path, ctx, body)),
      delete: <T,>(path: string) => withRetry<T>((ctx) => apiClient.delete<T>(path, ctx)),
    }),
    [withRetry],
  );
}
