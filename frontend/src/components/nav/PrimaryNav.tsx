"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, LayoutDashboard, ListChecks, Settings as SettingsIcon } from "lucide-react";
import type { ComponentType } from "react";

/**
 * Order matches UX_UI_Description.md's mandated information architecture:
 * Devices is the default destination for a returning user; nothing else earns
 * a top-level slot ahead of it.
 */
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { href: "/devices", label: "Devices", icon: Cpu },
  { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { href: "/rules", label: "Rules", icon: ListChecks },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function PrimaryNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={`flex flex-col gap-1 ${collapsed ? "p-2" : "p-4"}`}>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 rounded-md py-2 text-sm transition-colors duration-150 ${
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
    </nav>
  );
}
