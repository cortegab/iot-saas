"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { PrimaryNav } from "@/components/nav/PrimaryNav";
import { RealtimeStatusBadge } from "@/components/nav/RealtimeStatusBadge";
import { GlobalHeader } from "@/components/nav/GlobalHeader";

const SIDEBAR_COLLAPSED_KEY = "iot-saas:sidebar_collapsed";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, currentTenantId } = useAuth();
  const realtimeStatus = useRealtime();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

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

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
  }

  // Unauthenticated: the effect above is already redirecting; render nothing to
  // avoid a flash of app chrome with no valid session behind it.
  if (status !== "authenticated" || !currentTenantId) return null;

  return (
    <div className="flex min-h-screen">
      <aside
        className={`flex shrink-0 flex-col justify-between border-r border-border bg-surface transition-[width] duration-150 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div>
          <div className={`flex p-2 ${collapsed ? "justify-center" : "justify-end"}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              {collapsed ? <PanelLeftOpen aria-hidden size={18} /> : <PanelLeftClose aria-hidden size={18} />}
            </button>
          </div>
          <PrimaryNav collapsed={collapsed} />
        </div>
        {!collapsed && (
          <div className="border-t border-border p-2">
            <RealtimeStatusBadge status={realtimeStatus} />
          </div>
        )}
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <GlobalHeader />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
