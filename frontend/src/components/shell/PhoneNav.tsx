"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, LogOut, Menu, Search, WifiOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { Sheet } from "@/components/ui/Sheet";
import {
  AlertCount,
  LiveIndicator,
  ThemeButton,
  WorkspaceLogo,
  WorkspaceMenu,
  initialsFor,
} from "@/components/shell/AppSidebar";
import { CreateWorkspaceDialog } from "@/components/shell/CreateWorkspaceDialog";
import { MORE_ITEMS, TAB_ITEMS, activeHref } from "@/components/shell/nav-config";
import { useShell } from "@/components/shell/shell-context";
import { useNavCounts } from "@/components/shell/useShellData";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import type { RealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/cn";

const isDown = (realtime: RealtimeStatus) => realtime === "reconnecting" || realtime === "closed";

/** True once the live connection has been down for 1.5 s, so a token refresh
 * (an instant reconnect) doesn't flash the banner. */
function useDown(realtime: RealtimeStatus): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!isDown(realtime)) {
      setDown(false);
      return;
    }
    const t = setTimeout(() => setDown(true), 1500);
    return () => clearTimeout(t);
  }, [realtime]);
  return down;
}

/** Phone top bar (DESIGN.md §4, ≤ 640px): logo to Dashboards, the workspace
 * name, the live indicator only while reconnecting, and search. */
export function PhoneTopBar({ realtime }: { realtime: RealtimeStatus }) {
  const { memberships, currentTenantId } = useAuth();
  const { openPalette } = useShell();
  const down = useDown(realtime);
  const name = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_name ?? "";
  return (
    <header className="sticky top-0 z-20 flex h-[calc(52px+env(safe-area-inset-top,0px))] items-center gap-2.5 border-b border-border bg-surface pl-3.5 pr-1.5 pt-[env(safe-area-inset-top,0px)] rail:hidden">
      <Link href="/dashboards" aria-label={`${name}, go to dashboards`} className="rounded-[9px]">
        <WorkspaceLogo name={name} />
      </Link>
      <strong className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{name}</strong>
      {down && <LiveIndicator realtime={realtime} />}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search or run"
        className="grid h-11 w-11 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <Search aria-hidden size={18} />
      </button>
    </header>
  );
}

/** Phone bottom tab bar: Dashboards · Devices · Alerts · Rules · More. */
export function PhoneTabBar({ realtime }: { realtime: RealtimeStatus }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { unreadCount } = useNavCounts();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = active != null && MORE_ITEMS.some((i) => i.href === active);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const cell =
    "relative flex h-[58px] flex-col items-center justify-center gap-[3px] text-[11px] font-medium text-ink-muted";
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-[50] grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom,0px)] rail:hidden [:root:has(.app-shell_[data-savebar])_&]:hidden"
      >
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(cell, isActive && "text-accent-strong")}
            >
              <Icon aria-hidden size={20} />
              <span>{item.tabLabel ?? item.label}</span>
              {item.alertCount && unreadCount > 0 && (
                <AlertCount count={unreadCount} className="absolute left-[calc(50%+5px)] top-[5px] min-w-[17px] px-1 text-[10px] leading-4" />
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(cell, moreActive && "text-accent-strong")}
        >
          <Menu aria-hidden size={20} />
          More
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} realtime={realtime} />
    </>
  );
}

/** The More bottom sheet: who you are (with Sign out), the workspaces, the
 * rest of the nav, then the live indicator and the theme toggle. */
function MoreSheet({ open, onClose, realtime }: { open: boolean; onClose: () => void; realtime: RealtimeStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { can } = usePermissions();
  const { data: user } = useCurrentUser();
  const { memberships, currentTenantId, logout } = useAuth();
  const [creating, setCreating] = useState(false);
  const current = memberships.find((m) => m.tenant_id === currentTenantId);
  const role = toRole(current?.role);
  const items = MORE_ITEMS.filter((i) => !i.requires || can(i.requires));

  return (
    <>
      <Sheet open={open} onClose={onClose} label="More" side="bottom">
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3">
          <h2 className="text-base font-semibold text-ink">More</h2>
          <div className="flex items-center gap-3 border-b border-border-soft pb-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-muted text-sm font-semibold text-accent-strong">
              {user ? initialsFor(user.name, user.email) : "…"}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <b className="block truncate font-medium text-ink">{user?.name?.trim() || user?.email || "…"}</b>
              <span className="block truncate text-[13px] text-ink-muted">
                {[user?.email, role && current ? `${ROLE_LABEL[role]} of ${current.tenant_name}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void logout().then(() => router.replace("/login"))}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-ink hover:bg-surface-raised"
            >
              <LogOut aria-hidden size={14} />
              Sign out
            </button>
          </div>

          {memberships.length > 1 && (
            <WorkspaceMenu
              onCreate={() => {
                onClose();
                setCreating(true);
              }}
              onSwitched={() => {
                onClose();
                router.push("/dashboards");
              }}
            />
          )}

          <nav aria-label="More sections" className="overflow-hidden rounded-xl border border-border">
            {items.map((item, i) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={item.href === active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 px-3.5 text-sm text-ink hover:bg-row-hover aria-[current=page]:font-medium aria-[current=page]:text-accent-strong",
                    i > 0 && "border-t border-border-soft",
                  )}
                >
                  <Icon aria-hidden size={17} className="text-ink-muted" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight aria-hidden size={15} className="text-ink-muted" />
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center justify-between gap-3">
            <LiveIndicator realtime={realtime} className="text-[13px]" />
            <ThemeButton withLabel />
          </div>
        </div>
      </Sheet>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** DESIGN.md §4 reconnecting banner: while the live connection is down. */
export function ReconnectingBanner({ realtime }: { realtime: RealtimeStatus }) {
  const down = useDown(realtime);
  if (!down) return null;
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-border bg-status-pending-surface px-3.5 py-2.5 text-sm text-ink">
      <WifiOff aria-hidden size={15} className="mt-0.5 shrink-0 text-status-pending" />
      {realtime === "closed" ? (
        <span>
          <b className="font-semibold">Live updates are off.</b> Values on this page may be stale. Reload the page
          to try again.
        </span>
      ) : (
        <span>
          <b className="font-semibold">Reconnecting…</b> Live updates are paused, so values on this page may be
          stale.
        </span>
      )}
    </div>
  );
}
