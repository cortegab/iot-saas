"use client";

import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import type { components } from "@/types/api";

type NotificationSummaryResponse = components["schemas"]["NotificationSummaryResponse"];
type NotificationIdsRequest = components["schemas"]["NotificationIdsRequest"];

export const NOTIFICATIONS_KEY = "/notifications";
export const SUMMARY_KEY = `${NOTIFICATIONS_KEY}/summary`;

/** Revalidates every notifications key: the summary, each page of alerts and
 * each alert's history. */
export function refreshNotifications(): Promise<unknown> {
  return revalidate((key) => typeof key === "string" && (key === NOTIFICATIONS_KEY || key.startsWith(`${NOTIFICATIONS_KEY}/`) || key.startsWith(`${NOTIFICATIONS_KEY}?`)));
}

/** Alerts (repeats grouped) and how many are unread, by type; the nav badge
 * and the page's state filter. Counted by the API over the whole feed.
 *
 * A fallback, not the primary freshness mechanism — useRealtime revalidates
 * every /notifications key the moment a `notification` event arrives. */
export function useNotificationSummary() {
  const { data, error, isLoading } = useApiSWR<NotificationSummaryResponse>(SUMMARY_KEY, { refreshInterval: 30_000, keepPreviousData: true });
  return { summary: data, unreadCount: data?.unread ?? 0, error, isLoading };
}

/** Read / unread / dismiss on one alert (all its repeats), by its group key. */
export function useNotificationActions() {
  const api = useApi();
  const after = () => refreshNotifications();
  const group = (key: string) => `${NOTIFICATIONS_KEY}/groups/${encodeURIComponent(key)}`;

  return {
    markAllRead: () => api.post(`${NOTIFICATIONS_KEY}/read`).then(after),
    markRead: (key: string) => api.post(`${group(key)}/read`).then(after),
    markUnread: (key: string) => api.post(`${group(key)}/unread`).then(after),
    /** Returns the dismissed ids, for Undo. */
    dismiss: async (key: string) => {
      const { ids } = await api.post<NotificationIdsRequest>(`${group(key)}/dismiss`);
      await after();
      return ids;
    },
    restore: (ids: string[]) => api.post(`${NOTIFICATIONS_KEY}/restore`, { ids }).then(after),
  };
}
