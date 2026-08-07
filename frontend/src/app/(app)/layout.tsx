"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { PrimaryNav } from "@/components/nav/PrimaryNav";
import { TenantSwitcher } from "@/components/nav/TenantSwitcher";
import { RealtimeStatusBadge } from "@/components/nav/RealtimeStatusBadge";
import { GlobalHeader } from "@/components/nav/GlobalHeader";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, memberships, currentTenantId, setCurrentTenantId, logout } = useAuth();
  const realtimeStatus = useRealtime();
  const router = useRouter();

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
      <aside className="flex w-56 flex-col justify-between border-r border-border bg-surface">
        <PrimaryNav />
        <div className="border-t border-border p-2">
          <RealtimeStatusBadge status={realtimeStatus} />
          <TenantSwitcher
            memberships={memberships}
            currentTenantId={currentTenantId}
            onSwitch={setCurrentTenantId}
          />
          <button
            type="button"
            onClick={() => void logout().then(() => router.replace("/login"))}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <GlobalHeader />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
