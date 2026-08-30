"use client";

import { Menu } from "lucide-react";
import { useSidebar } from "@/components/nav/sidebar-context";

/** Hamburger for the header — opens the off-canvas nav below `md`. Hidden on
 * desktop, where the sidebar is always present. */
export function MobileNavTrigger() {
  const { setMobileOpen } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label="Open navigation"
      className="-ml-1 rounded-md p-2 text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
    >
      <Menu aria-hidden size={18} />
    </button>
  );
}
