"use client";

import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { can, toRole, type Action, type Role } from "@/lib/permissions";

/** The current member's role in the current workspace, and a `can()` bound
 * to it. */
export function usePermissions(): { role: Role | null; can: (action: Action) => boolean } {
  const { memberships, currentTenantId } = useAuth();
  const role = toRole(memberships.find((m) => m.tenant_id === currentTenantId)?.role);
  const check = useCallback((action: Action) => can(role, action), [role]);
  return { role, can: check };
}
