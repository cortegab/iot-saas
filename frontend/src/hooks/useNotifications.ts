"use client";

import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import type { components } from "@/types/api";

type NotificationResponse = components["schemas"]["NotificationResponse"];

export const NOTIFICATIONS_KEY = "/notifications";

/** A fallback, not the primary freshness mechanism — useRealtime revalidates
 * this same key the moment a `notification` event arrives over the socket.
 * Unread count is derived client-side from `read_at` rather than fetched as
 * a separate endpoint — one less thing to keep in sync. */
export function useNotifications() {
  const api = useApi();
  const { data, isLoading, error, mutate } = useApiSWR<NotificationResponse[]>(NOTIFICATIONS_KEY, {
    refreshInterval: 30_000,
  });

  const unreadCount = data?.filter((n) => n.read_at == null).length ?? 0;

  async function markAllRead() {
    await api.post<NotificationResponse[]>("/notifications/read");
    await mutate();
  }

  return { notifications: data ?? [], unreadCount, isLoading, error, markAllRead };
}
