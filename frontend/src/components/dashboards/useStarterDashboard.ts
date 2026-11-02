"use client";

import { useApi } from "@/hooks/useApi";
import { starterLayout } from "@/lib/starter-dashboard";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** "Build my dashboard" (DESIGN.md §10.2): a dashboard with a widget per
 * device, made with the ordinary create + layout calls and set as this
 * person's default, so they land on it from now on. Returns its id. */
export function useStarterDashboard() {
  const api = useApi();
  return async function build(name: string): Promise<string> {
    const [devices, templates] = await Promise.all([api.get<DeviceResponse[]>("/devices"), api.get<CatalogEntryResponse[]>("/catalog")]);
    const created = await api.post<DashboardResponse>("/dashboards", { name: name.slice(0, 100) });
    await api.patch(`/dashboards/${created.id}`, { layout: starterLayout(devices, templates) as unknown as Record<string, unknown>[] });
    await api.put(`/dashboards/${created.id}/default`);
    return created.id;
  };
}
