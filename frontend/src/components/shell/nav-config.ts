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
import type { MessageKey, T } from "@/lib/i18n";

/** Which list drives an item's right-aligned count. */
export type NavCountSource = "dashboards" | "devices" | "rules" | "templates" | "zones" | "members" | "keys";

export interface NavItem {
  href: string;
  /** Message keys (DESIGN.md §11a): shown through `t`. */
  label: MessageKey;
  /** The phone tab bar's label, where it differs ("Alerts"). */
  tabLabel?: MessageKey;
  icon: LucideIcon;
  count?: NavCountSource;
  /** Notifications: red unread badge instead of a count. */
  alertCount?: boolean;
  /** Hidden unless the role can do this (DESIGN.md: hide, don't disable). */
  requires?: Action;
  /** Hidden in Simple view (DESIGN.md §15a): set-up pages a client doesn't need. */
  fullOnly?: boolean;
  /** Its name in Simple view ("Automations"). */
  simpleLabel?: MessageKey;
}

export interface NavGroup {
  label: MessageKey;
  items: NavItem[];
}

/** DESIGN.md §4 grouped nav. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "nav.groups.monitor",
    items: [
      { href: "/dashboards", label: "nav.dashboards", icon: LayoutDashboard, count: "dashboards" },
      { href: "/devices", label: "nav.devices", icon: Cpu, count: "devices" },
      { href: "/notifications", label: "nav.notifications", tabLabel: "nav.alerts", icon: Bell, alertCount: true },
    ],
  },
  {
    label: "nav.groups.automate",
    items: [{ href: "/rules", label: "nav.rules", simpleLabel: "nav.automations", icon: ListChecks, count: "rules" }],
  },
  {
    label: "nav.groups.configure",
    items: [
      { href: "/templates", label: "nav.templates", icon: Boxes, count: "templates", fullOnly: true },
      { href: "/zones", label: "nav.zones", icon: MapPin, count: "zones", fullOnly: true },
    ],
  },
  {
    label: "nav.groups.admin",
    items: [
      { href: "/members", label: "nav.members", icon: Users, count: "members", requires: "members.manage", fullOnly: true },
      { href: "/keys", label: "nav.keys", icon: KeyRound, count: "keys", requires: "keys.manage", fullOnly: true },
      { href: "/settings", label: "nav.settings", icon: Settings },
    ],
  },
];

/** Whether a nav item shows for this role and view. */
export function navVisible(item: NavItem, can: (action: Action) => boolean, simple: boolean): boolean {
  return (!item.requires || can(item.requires)) && !(simple && item.fullOnly);
}

/** Its name in this view and language. */
export function navLabel(item: NavItem, simple: boolean, t: T): string {
  return t((simple && item.simpleLabel) || item.label);
}

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
