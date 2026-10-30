import type { components } from "@/types/api";

type LandingResponse = components["schemas"]["LandingResponse"];

/** The landing page every entry point goes through (sign-in, register, an
 * accepted invite, switching workspace). A `?next=` link skips it. */
export const HOME = "/home";

const lastKey = (tenantId: string) => `iot-saas:last-dashboard:${tenantId}`;

/** The dashboard this browser opened last in this workspace (DESIGN.md §8:
 * the landing's fallback when no default is set). A per-viewer convenience:
 * storage may be unavailable, so every read and write is guarded. */
export function readLastDashboard(tenantId: string): string | null {
  try {
    return window.localStorage.getItem(lastKey(tenantId));
  } catch {
    return null;
  }
}

export function rememberDashboard(tenantId: string, dashboardId: string): void {
  try {
    window.localStorage.setItem(lastKey(tenantId), dashboardId);
  } catch {
    // Private mode / blocked storage: the landing falls back to the newest.
  }
}

/** Where /home sends this person (DESIGN.md §4 Landing), from the API's
 * decision: Get started, the one-time Welcome, their default dashboard, else
 * the one opened last here (if it's still theirs), else their most recently
 * changed one, else Devices. */
export function landingPath(landing: LandingResponse, lastOpened: string | null): string {
  const page = PAGES[landing.target];
  if (page) return page;
  const ids = landing.dashboard_ids;
  const pick = landing.dashboard_id ?? (lastOpened && ids.includes(lastOpened) ? lastOpened : ids[0]);
  return pick ? `/dashboards/${pick}` : "/devices";
}

/** Targets with a page of their own; the others land on dashboards. */
const PAGES: Partial<Record<LandingResponse["target"], string>> = { setup: "/start" };
