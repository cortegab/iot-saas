import {
  Bell,
  Boxes,
  Cpu,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Action } from "@/lib/permissions";

/** Which list drives an item's right-aligned count. */
export type NavCountSource = "dashboards" | "devices" | "rules" | "templates" | "zones" | "members" | "keys";

export interface NavItem {
  href: string;
  label: string;
  /** The phone tab bar's label, where it differs ("Alerts"). */
  tabLabel?: string;
  icon: LucideIcon;
  count?: NavCountSource;
  /** Notifications: red unread badge instead of a count. */
  alertCount?: boolean;
  /** Hidden unless the role can do this (DESIGN.md: hide, don't disable). */
  requires?: Action;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** DESIGN.md §4 grouped nav. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard, count: "dashboards" },
      { href: "/devices", label: "Devices", icon: Cpu, count: "devices" },
      { href: "/notifications", label: "Notifications", tabLabel: "Alerts", icon: Bell, alertCount: true },
    ],
  },
  {
    label: "Automate",
    items: [{ href: "/rules", label: "Rules", icon: ListChecks, count: "rules" }],
  },
  {
    label: "Configure",
    items: [
      { href: "/templates", label: "Device templates", icon: Boxes, count: "templates" },
      { href: "/zones", label: "Zones", icon: MapPin, count: "zones" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/members", label: "Members", icon: Users, count: "members", requires: "members.manage" },
      { href: "/keys", label: "API keys", icon: KeyRound, count: "keys", requires: "keys.manage" },
      { href: "/settings", label: "Workspace settings", icon: Settings },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const ALL_HREFS = ALL_ITEMS.map((i) => i.href);

/** The phone tab bar's four destinations (DESIGN.md §4); "More" holds the rest. */
const TAB_HREFS = ["/dashboards", "/devices", "/notifications", "/rules"];
export const TAB_ITEMS: NavItem[] = TAB_HREFS.map((href) => ALL_ITEMS.find((i) => i.href === href)!);
export const MORE_ITEMS: NavItem[] = ALL_ITEMS.filter((i) => !TAB_HREFS.includes(i.href));

/** Longest matching prefix wins. */
export function activeHref(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
