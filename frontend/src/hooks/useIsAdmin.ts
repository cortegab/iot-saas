"use client";

import { usePermissions } from "@/hooks/usePermissions";

/** Admin/owner gate for mutating UI. Prefer `usePermissions().can(action)`
 * for new code — it says *what* is being allowed. The backend's
 * require_role(ADMIN) is the actual enforcement. */
export function useIsAdmin(): boolean {
  return usePermissions().can("devices.write");
}
