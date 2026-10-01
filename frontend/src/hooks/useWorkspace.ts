"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import type { components } from "@/types/api";

export type Workspace = components["schemas"]["TenantResponse"];

/** GET /tenants/current — the current workspace's settings (name, slug,
 * alert recipients, time zone). `timezone` falls back to UTC until loaded. */
export function useWorkspace() {
  const swr = useApiSWR<Workspace>("/tenants/current");
  return { ...swr, timezone: swr.data?.timezone ?? "UTC" };
}
