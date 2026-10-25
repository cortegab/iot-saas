"use client";

import useSWR from "swr";
import { useApi } from "@/hooks/useApi";
import type { ApiPage } from "@/lib/api-client";
import type { components } from "@/types/api";

type NotificationResponse = components["schemas"]["NotificationResponse"];

export const NOTIFICATIONS_KEY = "/notifications";

/** The latest `limit` notifications and how many there are in all
 * (X-Total-Count). The page's "Show older" raises `limit`, so one request
 * holds everything shown and read / unread / dismiss refresh all of it.
 *
 * A fallback, not the primary freshness mechanism — useRealtime revalidates
 * every /notifications key the moment a `notification` event arrives. Unread
 * count is derived client-side from `read_at` over what's loaded. Dismissed
 * rows never come back from the API, so they never count. */
export function useNotifications(limit = 50) {
  const api = useApi();
  const key = `${NOTIFICATIONS_KEY}?limit=${limit}`;
  const { data, isLoading, error, mutate } = useSWR<ApiPage<NotificationResponse>>(key, () => api.getPage<NotificationResponse>(key), {
    refreshInterval: 30_000,
    keepPreviousData: true,
  });

  const notifications = data?.items ?? [];
  const unreadCount = notifications.filter((n) => n.read_at == null).length;

  async function markAllRead() {
    await api.post<NotificationResponse[]>("/notifications/read");
    await mutate();
  }

  async function markRead(id: string) {
    await api.patch<NotificationResponse>(`/notifications/${id}/read`);
    await mutate();
  }

  async function markUnread(id: string) {
    await api.patch<NotificationResponse>(`/notifications/${id}/unread`);
    await mutate();
  }

  async function dismiss(id: string) {
    // Drop it at once; the server agrees a moment later.
    await mutate((page) => page && { items: page.items.filter((n) => n.id !== id), total: page.total - 1 }, { revalidate: false });
    await api.post<NotificationResponse>(`/notifications/${id}/dismiss`);
    await mutate();
  }

  async function restore(id: string) {
    await api.post<NotificationResponse>(`/notifications/${id}/restore`);
    await mutate();
  }

  return {
    notifications,
    /** Every notification, loaded or not. */
    total: data?.total ?? 0,
    unreadCount,
    isLoading,
    error,
    markAllRead,
    markRead,
    markUnread,
    dismiss,
    restore,
  };
}
