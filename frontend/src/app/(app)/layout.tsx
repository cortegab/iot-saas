"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { PrimaryNav } from "@/components/nav/PrimaryNav";
import { RealtimeStatusBadge } from "@/components/nav/RealtimeStatusBadge";
import { GlobalHeader } from "@/components/nav/GlobalHeader";
import { SidebarContext } from "@/components/nav/sidebar-context";
import { cn } from "@/lib/cn";

const SIDEBAR_COLLAPSED_KEY = "iot-saas:sidebar_collapsed";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, currentTenantId } = useAuth();
  const realtimeStatus = useRealtime();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Don't let the page behind the drawer scroll on mobile.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
  }

  // Unauthenticated: the effect above is already redirecting; render nothing to
  // avoid a flash of app chrome with no valid session behind it.
  if (status !== "authenticated" || !currentTenantId) return null;

  // On mobile the drawer is always full-width with labels; `collapsed` only
  // governs the desktop rail.
  const railCollapsed = collapsed && !mobileOpen;

  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen }}>
      <div className="app-shell flex min-h-screen">
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-30 bg-canvas/70 md:hidden"
          />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col justify-between overflow-y-auto border-r border-border bg-surface transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width]",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            railCollapsed ? "md:w-16" : "md:w-56",
          )}
        >
          <div>
            <div className={cn("flex p-2", railCollapsed ? "justify-center" : "justify-between")}>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink md:block"
              >
                {collapsed ? <PanelLeftOpen aria-hidden size={18} /> : <PanelLeftClose aria-hidden size={18} />}
              </button>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink md:hidden"
              >
                <X aria-hidden size={18} />
              </button>
            </div>
            <PrimaryNav collapsed={railCollapsed} />
          </div>
          {!railCollapsed && (
            <div className="border-t border-border p-2">
              <RealtimeStatusBadge status={realtimeStatus} />
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <GlobalHeader />
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
