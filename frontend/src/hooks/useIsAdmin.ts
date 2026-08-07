"use client";

import { useAuth } from "@/hooks/useAuth";

/** Admin/owner gate for mutating UI (rule builder, actuator control) — the
 * backend's require_role(ADMIN) is the actual enforcement; this only avoids
 * showing a viewer a control that would 403. */
export function useIsAdmin(): boolean {
  const { memberships, currentTenantId } = useAuth();
  const role = memberships.find((m) => m.tenant_id === currentTenantId)?.role;
  return role === "owner" || role === "admin";
}
