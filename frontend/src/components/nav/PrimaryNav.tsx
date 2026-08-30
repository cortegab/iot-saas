"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Boxes, Cpu, LayoutDashboard, ListChecks, Settings } from "lucide-react";
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
 * Daily-operations links sit in the unlabelled primary block; setup that isn't
 * touched every day (templates, workspace/access settings) is under CONFIGURE.
 * `/settings` redirects to the first sub-page and owns its own secondary nav
 * (app/(app)/settings/layout.tsx).
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
      { href: "/devices", label: "Devices", icon: Cpu },
      { href: "/rules", label: "Rules", icon: ListChecks },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/devices/templates", label: "Device Templates", icon: Boxes },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));

/** Longest matching prefix wins, so `/devices/templates/*` lights "Device
 * Templates" and not also "Devices" (both are prefixes), and `/settings/*`
 * lights "Settings". */
function activeHref(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}

export function PrimaryNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const active = activeHref(pathname);

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
            const isActive = item.href === active;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md py-2 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  isActive
                    ? "bg-surface-raised font-medium text-ink shadow-[inset_2px_0_0_var(--color-accent)]"
                    : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                }`}
              >
                {/* shrink-0: without it, a cramped collapsed rail forces flexbox to
                    scale the SVG down to fit rather than keep it at `size`. */}
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
