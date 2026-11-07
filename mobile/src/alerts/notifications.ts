import type { components, operations } from "@iodriven/shared/api";
import { useSWRConfig } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";

type NotificationSummaryResponse = components["schemas"]["NotificationSummaryResponse"];
type NotificationIdsRequest = components["schemas"]["NotificationIdsRequest"];
export type AlertGroup = components["schemas"]["NotificationGroupResponse"];
export type NotificationType = NonNullable<NonNullable<operations["list_groups_notifications_groups_get"]["parameters"]["query"]>["type"]>;

export const NOTIFICATIONS_KEY = "/notifications";
export const SUMMARY_KEY = `${NOTIFICATIONS_KEY}/summary`;
export const PAGE_SIZE = 25;

/** Every notifications key (summary, pages): what a `notification` event or a
 * write revalidates. */
export const isNotificationsKey = (key: unknown) => {
  if (typeof key !== "string") return false;
  // useSWRInfinite stores its pages under "$inf$" + the first page's key.
  const k = key.startsWith("$inf$") ? key.slice(5) : key;
  return k === NOTIFICATIONS_KEY || k.startsWith(`${NOTIFICATIONS_KEY}/`) || k.startsWith(`${NOTIFICATIONS_KEY}?`);
};

/** The web's state filter (DESIGN.md §8): all, unread, or one type's unread
 * alerts. A rule firing and its clearing are both "Rules". */
export const TYPES: { value: NotificationType; label: string }[] = [
  { value: "device_offline", label: "Offline" },
  { value: "rules", label: "Rules" },
  { value: "rule_health", label: "Rule health" },
  { value: "delivery_failed", label: "Failed deliveries" },
  { value: "template_changed", label: "Templates" },
];
export type AlertFilter = "all" | "unread" | NotificationType;

/** One page of alert groups, filtered like the web's list. */
export function groupsPageKey(filter: AlertFilter, page: number): string {
  const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (filter !== "all") q.set("unread", "true");
  if (filter !== "all" && filter !== "unread") q.set("type", filter);
  return `${NOTIFICATIONS_KEY}/groups?${q.toString()}`;
}

/** Alerts and how many are unread, by type: the tab badge and the filter. */
export function useNotificationSummary() {
  const { data, error } = useApiSWR<NotificationSummaryResponse>(SUMMARY_KEY, { refreshInterval: 30_000, keepPreviousData: true });
  return { summary: data, unread: data?.unread ?? 0, error };
}

/** Read / unread / dismiss on one alert (all its repeats), by its group key. */
export function useNotificationActions() {
  const api = useApi();
  const { mutate } = useSWRConfig();
  const after = () => mutate(isNotificationsKey);
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
