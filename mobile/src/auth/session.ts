/** Session rules shared by the provider and its tests: which workspace to
 * open, and when a failed refresh ends the session. Mirrors the web's
 * lib/auth-context.tsx. */
import { ApiRequestError } from "@iodriven/shared/api-client";
import type { components } from "@iodriven/shared/api";

type MembershipSummary = components["schemas"]["MembershipSummary"];

/** The workspace to open: the one asked for, else the one used last, else the
 * first. A remembered workspace counts only while still a member of it (left,
 * removed or deleted otherwise). */
export function pickTenant(
  memberships: MembershipSummary[],
  requested?: string | null,
  remembered?: string | null,
): string | null {
  const isMember = (id: string | null | undefined): id is string => !!id && memberships.some((m) => m.tenant_id === id);
  return [requested, remembered].find(isMember) ?? memberships[0]?.tenant_id ?? null;
}

/** Transient failures (no network, the API restarting, a 5xx) are retried at
 * these delays; only the API saying the token is bad ends the session. */
export const RETRY_DELAYS_MS = [500, 1500, 3000];

export function isRejection(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.status === 401 || err.status === 403);
}

/** Sign-in's message for an error, worded as on the web's sign-in page. */
export function signInError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    return err.status === 401 ? "That email and password don't match. Check both and try again." : "Couldn't sign in right now. Try again in a moment.";
  }
  return "Can't reach IO Driven. Check your connection and try again.";
}

/** Only an in-app path may be a `?next=` target (as on the web). */
export function safeNext(next: string | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}
