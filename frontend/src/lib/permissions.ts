/**
 * What each workspace role may do in the UI. Mirrors the backend's
 * `require_role` gates (tenants/deps.py) so the UI hides what the API would
 * refuse — the backend stays the actual enforcement. DESIGN.md: viewers get
 * read-only views with edit actions hidden, not disabled.
 *
 * Roles rank owner > admin > viewer.
 */

export type Role = "owner" | "admin" | "viewer";

export type Action =
  | "devices.write"
  | "templates.write"
  | "zones.write"
  | "rules.write"
  | "commands.send"
  | "members.manage"
  | "members.grantOwner"
  | "keys.manage"
  | "workspace.rename"
  | "workspace.alerts"
  | "dashboards.write";

const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

const MIN_ROLE: Record<Action, Role> = {
  "devices.write": "admin",
  "templates.write": "admin",
  "zones.write": "admin",
  "rules.write": "admin",
  "commands.send": "admin",
  "members.manage": "admin",
  "members.grantOwner": "owner",
  "keys.manage": "admin",
  "workspace.rename": "owner",
  // Alert recipients and the time zone (DESIGN.md §8); renaming stays owner-only.
  "workspace.alerts": "admin",
  // Dashboards are personal: every member edits their own.
  "dashboards.write": "viewer",
};

export function toRole(role: string | null | undefined): Role | null {
  return role === "owner" || role === "admin" || role === "viewer" ? role : null;
}

export function can(role: string | null | undefined, action: Action): boolean {
  const r = toRole(role);
  if (!r) return false;
  return RANK[r] >= RANK[MIN_ROLE[action]];
}

/** Roles `actor` may assign to someone else: never above their own. */
export function assignableRoles(actor: string | null | undefined): Role[] {
  const r = toRole(actor);
  if (!r) return [];
  return (["viewer", "admin", "owner"] as Role[]).filter((x) => RANK[x] <= RANK[r]);
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" };
