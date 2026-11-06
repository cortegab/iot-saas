import { can, type Action } from "@iodriven/shared/permissions";
import { useAuth } from "@/auth/AuthProvider";

/** Whether the current workspace role allows an action (the web's
 * usePermissions().can). The API's role checks are the real enforcement. */
export function useCan(action: Action): boolean {
  const { currentMembership } = useAuth();
  return can(currentMembership?.role, action);
}
