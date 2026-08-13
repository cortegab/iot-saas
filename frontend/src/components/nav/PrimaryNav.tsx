"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  Building2,
  Cpu,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Shield,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

interface NavLink {
  href: string;
  label: string;
  icon: Icon;
}

interface NavGroup {
  label?: string;
  items: NavLink[];
}

/**
 * Grouped IA per the UX spec: Devices (Devices, Device Templates), Automation
 * (Rules), Monitoring (Dashboards, Notifications), Settings (Organization,
 * Users, Roles & Permissions, API/Tokens). Webhooks is omitted — no backend
 * resource exists for it yet.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Devices",
    items: [
      { href: "/devices", label: "Devices", icon: Cpu },
      { href: "/devices/templates", label: "Device Templates", icon: Boxes },
    ],
  },
  {
    label: "Automation",
    items: [{ href: "/rules", label: "Rules", icon: ListChecks }],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/organization", label: "Organization", icon: Building2 },
      { href: "/settings/users", label: "Users", icon: Users },
      { href: "/settings/roles", label: "Roles & Permissions", icon: Shield },
      { href: "/settings/tokens", label: "API / Tokens", icon: KeyRound },
    ],
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (pathname === href) return true;
  // Prevents "/devices" from lighting up for "/devices/templates" links (both
  // are real prefixes of each other's sibling paths in this IA).
  return pathname != null && pathname.startsWith(`${href}/`);
}

export function PrimaryNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={`flex flex-col gap-4 ${collapsed ? "p-2" : "p-4"}`}>
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label ?? gi} className="flex flex-col gap-1">
          {group.label && !collapsed && (
            <span className="px-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {group.label}
            </span>
          )}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md py-2 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  active
                    ? "bg-surface-raised text-ink font-medium"
                    : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                }`}
              >
                {/* shrink-0: without it, a cramped collapsed rail forces flexbox to
                    scale the SVG down to fit rather than keep it at `size` — a
                    replaced element's default min-width lets it shrink below its
                    intrinsic size the way text can't. */}
                <Icon aria-hidden size={18} className="shrink-0" />
                {!collapsed && item.label}
                {collapsed && <span className="sr-only">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
