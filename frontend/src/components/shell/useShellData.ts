"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import { useNotifications } from "@/hooks/useNotifications";
import { usePermissions } from "@/hooks/usePermissions";
import type { NavCountSource } from "@/components/shell/nav-config";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type DashboardResponse = components["schemas"]["DashboardResponse"];
type MemberResponse = components["schemas"]["MemberResponse"];
type ApiKeyResponse = components["schemas"]["ApiKeyResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

/** The lists the shell needs for nav counts and ⌘K search. Same SWR keys the
 * list pages use, so they share one cache. Admin-only lists are only fetched
 * for roles that may read them. */
export function useShellData() {
  const { can } = usePermissions();
  const devices = useApiSWR<DeviceResponse[]>("/devices");
  const rules = useApiSWR<RuleResponse[]>("/rules");
  const templates = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const dashboards = useApiSWR<DashboardResponse[]>("/dashboards");
  const zones = useApiSWR<ZoneResponse[]>("/zones");
  const members = useApiSWR<MemberResponse[]>(can("members.manage") ? "/tenants/members" : null);
  const keys = useApiSWR<ApiKeyResponse[]>(can("keys.manage") ? "/api-keys" : null);
  const { unreadCount } = useNotifications();

  const counts: Partial<Record<NavCountSource, number>> = {
    devices: devices.data?.length,
    rules: rules.data?.length,
    templates: templates.data?.length,
    dashboards: dashboards.data?.length,
    zones: zones.data?.length,
    members: members.data?.length,
    keys: keys.data?.filter((k) => !k.revoked_at).length,
  };

  return {
    devices: devices.data ?? [],
    rules: rules.data ?? [],
    templates: templates.data ?? [],
    dashboards: dashboards.data ?? [],
    zones: zones.data ?? [],
    members: members.data ?? [],
    counts,
    unreadCount,
  };
}
