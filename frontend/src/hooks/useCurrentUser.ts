"use client";

import { useApiSWR } from "@/hooks/useApiSWR";
import type { components } from "@/types/api";

type UserResponse = components["schemas"]["UserResponse"];

/** GET /auth/me — the current user's own account details (email, id,
 * created_at). Not part of AuthContext's state: that context only carries
 * what auth flow/session management needs (token, memberships, current
 * tenant); this is a plain cached fetch for anything that wants to display
 * "who am I", starting with the header's user menu. */
export function useCurrentUser() {
  return useApiSWR<UserResponse>("/auth/me");
}
