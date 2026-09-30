"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Globe, LogOut, Moon, Plus, Search, Sun, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useTheme } from "@/hooks/useTheme";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { NAV_GROUPS, activeHref } from "@/components/shell/nav-config";
import { useShell } from "@/components/shell/shell-context";
import { useShellData } from "@/components/shell/useShellData";
import { CreateWorkspaceDialog } from "@/components/shell/CreateWorkspaceDialog";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import type { RealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/cn";

export function initialsFor(name: string | null | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || email.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/** Logo tile for a workspace: its initial on the accent→data gradient. */
export function WorkspaceLogo({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(135deg,var(--color-accent),var(--color-chart))] text-sm font-bold text-on-accent",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

const LIVE_LABEL: Record<RealtimeStatus, { label: string; dot: string }> = {
  open: { label: "Live updates on", dot: "bg-status-online" },
  connecting: { label: "Connecting…", dot: "bg-status-unknown" },
  reconnecting: { label: "Reconnecting…", dot: "bg-status-pending" },
  closed: { label: "Live updates off", dot: "bg-status-offline" },
};

/** DESIGN.md §4 sidebar: workspace switcher, ⌘K trigger, grouped nav with
 * counts, and the footer (user, live-connection indicator, theme toggle). */
export function AppSidebar({ realtime }: { realtime: RealtimeStatus }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { can } = usePermissions();
  const { openPalette } = useShell();
  const { counts, unreadCount } = useShellData();

  return (
    <div className="flex h-full flex-col gap-3.5 px-3 py-3.5">
      <WorkspaceSwitcher deviceCount={counts.devices} />

      <button
        type="button"
        onClick={openPalette}
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface pl-2.5 pr-2 text-[13.5px] text-ink-muted shadow-card transition-colors hover:border-accent hover:text-ink"
      >
        <Search aria-hidden size={15} />
        <span className="flex-1 truncate text-left">Search or run…</span>
        <kbd className="rounded border border-b-2 border-border bg-surface-raised px-[5px] font-mono text-[11px] text-ink-muted">
          ⌘K
        </kbd>
      </button>

      <nav aria-label="Sections" className="flex flex-col gap-3.5">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.requires || can(i.requires));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="flex flex-col gap-px">
              <span className="px-2.5 py-1 text-xs font-medium text-ink-muted">{group.label}</span>
              {items.map((item) => {
                const isActive = item.href === active;
                const Icon = item.icon;
                const count = item.count ? counts[item.count] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm transition-colors duration-150",
                      isActive
                        ? "bg-accent-muted font-medium text-accent-strong"
                        : "text-ink hover:bg-surface-raised",
                    )}
                  >
                    <Icon aria-hidden size={17} className={cn("shrink-0", isActive ? "text-accent" : "text-ink-muted")} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.alertCount
                      ? unreadCount > 0 && (
                          <span className="rounded-full bg-status-offline px-1.5 text-[11px] font-semibold leading-[18px] text-on-accent">
                            <span className="sr-only">, </span>
                            {unreadCount > 99 ? "99+" : unreadCount}
                            <span className="sr-only"> unread</span>
                          </span>
                        )
                      : count != null && (
                          <span className="text-xs tabular-nums text-ink-muted">{count}</span>
                        )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2 border-t border-border px-1.5 pt-2.5">
        <UserMenu realtime={realtime} />
        <ThemeButton />
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ deviceCount }: { deviceCount?: number }) {
  const router = useRouter();
  const { memberships, currentTenantId, setCurrentTenantId } = useAuth();
  const [creating, setCreating] = useState(false);
  const current = memberships.find((m) => m.tenant_id === currentTenantId);
  const role = toRole(current?.role);
  const sub = [role ? ROLE_LABEL[role] : null, deviceCount != null ? `${deviceCount} device${deviceCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <DropdownMenu
        label="Switch workspace"
        align="start"
        panelClassName="w-[232px] p-1"
        triggerClassName="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-surface-raised"
        trigger={
          <>
            <WorkspaceLogo name={current?.tenant_name ?? ""} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <strong className="truncate text-sm font-semibold text-ink">{current?.tenant_name ?? "Workspace"}</strong>
              <span className="truncate text-xs text-ink-muted">{sub}</span>
            </span>
            <ChevronsUpDown aria-hidden size={15} className="shrink-0 text-ink-muted" />
          </>
        }
      >
        <div role="menu" aria-label="Workspaces" className="flex flex-col">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Workspaces
          </p>
          {memberships.map((m) => {
            const r = toRole(m.role);
            const isCurrent = m.tenant_id === currentTenantId;
            return (
              <button
                key={m.tenant_id}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  if (isCurrent) return;
                  setCurrentTenantId(m.tenant_id);
                  router.push("/dashboards");
                }}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                <WorkspaceLogo name={m.tenant_name} className="h-6 w-6 rounded-md text-xs" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-ink">{m.tenant_name}</span>
                  <span className="text-xs text-ink-muted">{r ? ROLE_LABEL[r] : m.role}</span>
                </span>
                {isCurrent && <Check aria-hidden size={15} className="text-accent" />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-sm text-ink hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
          >
            <Plus aria-hidden size={15} className="text-ink-muted" />
            Create workspace
          </button>
        </div>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function UserMenu({ realtime }: { realtime: RealtimeStatus }) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const { logout } = useAuth();
  const live = LIVE_LABEL[realtime];
  const displayName = user?.name?.trim() || user?.email || "…";

  return (
    <DropdownMenu
      label="Account menu"
      align="start"
      panelClassName="w-[220px] p-1"
      triggerClassName="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-surface-raised"
      trigger={
        <>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-muted text-[11.5px] font-semibold text-accent-strong">
            {user ? initialsFor(user.name, user.email) : "…"}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <strong className="truncate text-[13px] font-medium text-ink">{displayName}</strong>
            <span className="inline-flex items-center gap-[5px] text-[11.5px] text-ink-muted" title="This browser's connection to the platform">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", live.dot)} />
              {live.label}
            </span>
          </span>
        </>
      }
    >
      <div role="menu" aria-label="Account" className="flex flex-col">
        {user && (
          <div className="border-b border-border px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-ink">{displayName}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>
        )}
        <div className="flex flex-col pt-1">
          <MenuLink href="/settings#profile" icon={<UserRound size={15} />} label="Profile" />
          <MenuLink href="/" icon={<Globe size={15} />} label="Website" />
          <div className="my-1 h-px bg-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout().then(() => router.replace("/login"))}
            className="flex items-center gap-[9px] rounded-md px-2.5 py-[7px] text-left text-sm text-ink hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
          >
            <LogOut aria-hidden size={15} className="text-ink-muted" />
            Sign out
          </button>
        </div>
      </div>
    </DropdownMenu>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-[9px] rounded-md px-2.5 py-[7px] text-sm text-ink hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
    >
      <span aria-hidden className="text-ink-muted">
        {icon}
      </span>
      {label}
    </Link>
  );
}

/** Footer theme toggle: flips between light and dark (the OS preference is
 * followed until the user picks). */
export function ThemeButton() {
  const { theme, setPreference, mounted } = useTheme();
  const isDark = mounted && theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
    >
      {isDark ? <Sun aria-hidden size={16} /> : <Moon aria-hidden size={16} />}
    </button>
  );
}
