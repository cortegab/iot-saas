"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Order matches UX_UI_Description.md's mandated information architecture:
 * Devices is the default destination for a returning user; nothing else earns
 * a top-level slot ahead of it.
 */
const NAV_ITEMS = [
  { href: "/devices", label: "Devices" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
] as const;

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-4">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
              active
                ? "bg-surface-raised text-ink font-medium"
                : "text-ink-muted hover:bg-surface-raised hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
