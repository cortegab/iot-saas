"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";

const TABS = [
  { href: "/settings/organization", label: "Organization" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/roles", label: "Roles & Permissions" },
  { href: "/settings/tokens", label: "API tokens" },
];

/** Settings is one sidebar entry now; its sub-pages hang off this secondary nav
 * instead of four separate top-level links. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings" subtitle="Workspace, people, and access" />
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((tab) => {
            const active = tab === current;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  active
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
