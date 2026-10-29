"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { useNotificationSummary } from "@/hooks/useNotifications";
import { usePermissions } from "@/hooks/usePermissions";
import type { NavCountSource } from "@/components/shell/nav-config";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type DashboardResponse = components["schemas"]["DashboardResponse"];
type MemberResponse = components["schemas"]["MemberResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

type NavCountsResponse = components["schemas"]["NavCountsResponse"];

/** The nav's counts and unread alerts — one request (GET /tenants/current/counts),
 * not every list, so a full page load doesn't fetch all devices, rules and
 * templates just to show their number. Any write revalidates it (useApi). */
export function useNavCounts() {
  const { data } = useApiSWR<NavCountsResponse>("/tenants/current/counts");
  const { unreadCount } = useNotificationSummary();
  const counts: Partial<Record<NavCountSource, number>> = {
    devices: data?.devices,
    rules: data?.rules,
    templates: data?.templates,
    dashboards: data?.dashboards,
    zones: data?.zones,
    members: data?.members ?? undefined,
    keys: data?.api_keys ?? undefined,
  };
  return { counts, unreadCount };
}

/** The lists ⌘K searches. Only the open palette calls it, so they load when
 * it's opened; same SWR keys as the list pages, so they share one cache.
 * Admin-only lists are only fetched for roles that may read them. */
export function usePaletteData() {
  const { can } = usePermissions();
  const devices = useApiSWR<DeviceResponse[]>("/devices");
  const rules = useApiSWR<RuleResponse[]>("/rules");
  const templates = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const dashboards = useApiSWR<DashboardResponse[]>("/dashboards");
  const zones = useApiSWR<ZoneResponse[]>("/zones");
  const members = useApiSWR<MemberResponse[]>(can("members.manage") ? "/tenants/members" : null);

  return {
    devices: devices.data ?? [],
    rules: rules.data ?? [],
    templates: templates.data ?? [],
    dashboards: dashboards.data ?? [],
    zones: zones.data ?? [],
    members: members.data ?? [],
  };
}
