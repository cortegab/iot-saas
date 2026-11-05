import { ApiRequestError, type ApiClientContext, type JsonBody } from "@iodriven/shared/api-client";
import { useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import { useAuth } from "@/auth/AuthProvider";
import { api } from "@/lib/api";

/** Workspace-scoped API calls for signed-in screens, as on the web
 * (frontend/src/hooks/useApi.ts): the session's token and workspace, and one
 * retry after refreshing when the access token expired mid-session. A write
 * revalidates every cached read except telemetry history. */
export function useApi() {
  const { accessToken, currentTenantId, refresh } = useAuth();
  const { mutate } = useSWRConfig();

  const withRetry = useCallback(
    async <T,>(fn: (ctx: ApiClientContext) => Promise<T>): Promise<T> => {
      try {
        return await fn({ accessToken, tenantId: currentTenantId });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          const refreshed = await refresh();
          if (refreshed) return await fn({ accessToken: refreshed.access_token, tenantId: currentTenantId });
        }
        throw err;
      }
    },
    [accessToken, currentTenantId, refresh],
  );

  return useMemo(() => {
    const afterWrite = <T,>(result: T): T => {
      void mutate((key) => typeof key === "string" && !key.includes("/data?metric=") && !key.endsWith("/latest"));
      return result;
    };
    return {
      get: <T,>(path: string) => withRetry<T>((ctx) => api.get<T>(path, ctx)),
      getPage: <T,>(path: string) => withRetry((ctx) => api.getPage<T>(path, ctx)),
      post: <T,>(path: string, body?: JsonBody) => withRetry<T>((ctx) => api.post<T>(path, ctx, body)).then(afterWrite),
      patch: <T,>(path: string, body?: JsonBody) => withRetry<T>((ctx) => api.patch<T>(path, ctx, body)).then(afterWrite),
      put: <T,>(path: string, body?: JsonBody) => withRetry<T>((ctx) => api.put<T>(path, ctx, body)).then(afterWrite),
      delete: <T,>(path: string) => withRetry<T>((ctx) => api.delete<T>(path, ctx)).then(afterWrite),
    };
  }, [withRetry, mutate]);
}
