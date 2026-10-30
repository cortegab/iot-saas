"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronsUpDown,
  Globe,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useTheme } from "@/hooks/useTheme";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { NAV_GROUPS, activeHref } from "@/components/shell/nav-config";
import { useShell } from "@/components/shell/shell-context";
import { useNavCounts } from "@/components/shell/useShellData";
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

export const LIVE_LABEL: Record<RealtimeStatus, { label: string; dot: string }> = {
  open: { label: "Live updates on", dot: "bg-status-online" },
  connecting: { label: "Connecting…", dot: "bg-status-unknown" },
  reconnecting: { label: "Reconnecting…", dot: "bg-status-pending" },
  closed: { label: "Live updates off", dot: "bg-status-offline" },
};

/** The live-connection indicator: a dot and its words. */
export function LiveIndicator({ realtime, className }: { realtime: RealtimeStatus; className?: string }) {
  const live = LIVE_LABEL[realtime];
  return (
    <span
      className={cn("inline-flex items-center gap-[5px] text-xs text-ink-muted", className)}
      title="This browser's connection to the platform"
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", live.dot)} />
      {live.label}
    </span>
  );
}

/** The red unread badge on Notifications. */
export function AlertCount({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full bg-status-offline px-1.5 text-xs font-semibold leading-[18px] text-on-accent",
        className,
      )}
    >
      <span className="sr-only">, </span>
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

interface Tip {
  label: string;
  left: number;
  top: number;
}

/** The rail's floating labels (DESIGN.md §4): beside the icon, on hover and
 * focus. Portaled, because the nav scrolls and would clip a CSS ::after. */
function useRailTips(enabled: boolean) {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!enabled) setTip(null);
  }, [enabled]);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  function show(e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const label = e.currentTarget.dataset.tip;
    if (!enabled || !label) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, left: r.right + 10, top: r.top + r.height / 2 });
  }

  const handlers = enabled
    ? { onMouseEnter: show, onFocus: show, onMouseLeave: () => setTip(null), onBlur: () => setTip(null) }
    : {};

  const node =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[95] -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-canvas"
            style={{ left: tip.left, top: tip.top }}
          >
            {tip.label}
          </div>,
          document.body,
        )
      : null;

  return { handlers, node };
}

export interface AppSidebarProps {
  realtime: RealtimeStatus;
  /** The 64px icon rail (641–1439px, not pinned open). */
  compact?: boolean;
  /** Rail widths only: opens or closes the full sidebar over the content.
   * Absent from 1440px, where the sidebar is always open. */
  onTogglePin?: () => void;
}

/** DESIGN.md §4 sidebar: workspace switcher, ⌘K trigger, grouped nav with
 * counts, and the footer (user, live-connection indicator, theme toggle).
 * `compact` draws the same thing as the icon rail. */
export function AppSidebar({ realtime, compact = false, onTogglePin }: AppSidebarProps) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { can } = usePermissions();
  const { openPalette } = useShell();
  const { counts, unreadCount, linkFor } = useNavCounts();
  const tips = useRailTips(compact);

  const pin = onTogglePin && (
    <button
      type="button"
      onClick={onTogglePin}
      aria-label={compact ? "Expand navigation" : "Collapse navigation"}
      aria-expanded={!compact}
      data-tip={compact ? "Expand navigation" : undefined}
      {...tips.handlers}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
    >
      {compact ? <PanelLeftOpen aria-hidden size={17} /> : <PanelLeftClose aria-hidden size={17} />}
    </button>
  );

  return (
    <div className={cn("flex h-full flex-col", compact ? "items-center gap-1.5 px-2 py-2.5" : "gap-3.5 px-3 py-3.5")}>
      <div className={cn("flex shrink-0", compact ? "flex-col items-center gap-1.5" : "items-center gap-1")}>
        <WorkspaceSwitcher deviceCount={counts.devices} compact={compact} tipHandlers={tips.handlers} />
        {pin}
      </div>

      <button
        type="button"
        onClick={openPalette}
        aria-label={compact ? "Search or run, Ctrl K" : undefined}
        data-tip={compact ? "Search or run… ⌘K" : undefined}
        {...tips.handlers}
        className={cn(
          "flex shrink-0 items-center rounded-md text-ink-muted transition-colors",
          compact
            ? "h-10 w-10 justify-center hover:bg-surface-raised hover:text-ink"
            : "h-9 gap-2 border border-border bg-surface pl-2.5 pr-2 text-meta shadow-card hover:border-accent hover:text-ink",
        )}
      >
        <Search aria-hidden size={15} />
        {!compact && (
          <>
            <span className="flex-1 truncate text-left">Search or run…</span>
            <kbd className="rounded border border-b-2 border-border bg-surface-raised px-[5px] font-mono text-xs text-ink-muted">
              ⌘K
            </kbd>
          </>
        )}
      </button>

      <nav
        aria-label="Main"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:thin]",
          compact ? "w-full items-center" : "-mx-1 gap-3.5 px-1",
        )}
      >
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter((i) => !i.requires || can(i.requires));
          if (items.length === 0) return null;
          return (
            <div
              key={group.label}
              className={cn(
                "flex flex-col gap-px",
                compact && "w-full items-center py-1",
                compact && gi > 0 && "border-t border-border-soft",
              )}
            >
              {!compact && <span className="px-2.5 py-1 text-xs font-medium text-ink-muted">{group.label}</span>}
              {items.map((item) => {
                const isActive = item.href === active;
                const Icon = item.icon;
                const count = item.count ? counts[item.count] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={linkFor(item.href)}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={compact ? item.label : undefined}
                    data-tip={compact ? item.label : undefined}
                    {...tips.handlers}
                    className={cn(
                      "relative flex items-center rounded-md text-sm transition-colors duration-150",
                      compact ? "h-10 w-10 justify-center" : "gap-2.5 px-2.5 py-[7px]",
                      isActive ? "bg-accent-muted font-medium text-accent-strong" : "text-ink hover:bg-surface-raised",
                    )}
                  >
                    <Icon aria-hidden size={17} className={cn("shrink-0", isActive ? "text-accent" : "text-ink-muted")} />
                    {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                    {item.alertCount
                      ? unreadCount > 0 && (
                          <AlertCount
                            count={unreadCount}
                            className={compact ? "absolute -right-0.5 -top-0.5 min-w-4 px-1 text-xs leading-4" : undefined}
                          />
                        )
                      : !compact &&
                        count != null && <span className="text-xs tabular-nums text-ink-muted">{count}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex shrink-0 border-t border-border",
          compact ? "flex-col items-center gap-2 pt-2" : "items-center gap-2 px-1.5 pt-2.5",
        )}
      >
        <UserMenu realtime={realtime} compact={compact} tipHandlers={tips.handlers} />
        <ThemeButton />
      </div>
      {tips.node}
    </div>
  );
}

type TipHandlers = ReturnType<typeof useRailTips>["handlers"];

function WorkspaceSwitcher({
  deviceCount,
  compact = false,
  tipHandlers,
}: {
  deviceCount?: number;
  compact?: boolean;
  tipHandlers?: TipHandlers;
}) {
  const router = useRouter();
  const { memberships, currentTenantId } = useAuth();
  const [creating, setCreating] = useState(false);
  const current = memberships.find((m) => m.tenant_id === currentTenantId);
  const role = toRole(current?.role);
  const sub = [role ? ROLE_LABEL[role] : null, deviceCount != null ? `${deviceCount} device${deviceCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
  const name = current?.tenant_name ?? "Workspace";

  return (
    <>
      <span data-tip={compact ? `${name}${sub ? ` · ${sub}` : ""}` : undefined} {...tipHandlers} className={cn(!compact && "min-w-0 flex-1")}>
        <DropdownMenu
          label={`Workspace: ${name}. Switch workspace`}
          align="start"
          panelClassName="w-[232px] p-1"
          triggerClassName={cn(
            "flex items-center rounded-md text-left hover:bg-surface-raised",
            compact ? "p-1" : "w-full gap-2.5 p-2",
          )}
          trigger={
            compact ? (
              <WorkspaceLogo name={current?.tenant_name ?? ""} />
            ) : (
              <>
                <WorkspaceLogo name={current?.tenant_name ?? ""} />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <strong className="truncate text-sm font-semibold text-ink">{name}</strong>
                  <span className="truncate text-xs text-ink-muted">{sub}</span>
                </span>
                <ChevronsUpDown aria-hidden size={15} className="shrink-0 text-ink-muted" />
              </>
            )
          }
        >
          <WorkspaceMenu onCreate={() => setCreating(true)} onSwitched={() => router.push("/dashboards")} />
        </DropdownMenu>
      </span>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** The workspace list with "Create workspace": the switcher's panel, and the
 * phone More sheet's workspace block. */
export function WorkspaceMenu({ onCreate, onSwitched }: { onCreate: () => void; onSwitched: () => void }) {
  const { memberships, currentTenantId, setCurrentTenantId } = useAuth();
  return (
    <div role="menu" aria-label="Workspaces" className="flex flex-col">
      <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
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
              onSwitched();
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
        onClick={onCreate}
        className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-sm text-ink hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
      >
        <Plus aria-hidden size={15} className="text-ink-muted" />
        Create workspace
      </button>
    </div>
  );
}

function UserMenu({
  realtime,
  compact = false,
  tipHandlers,
}: {
  realtime: RealtimeStatus;
  compact?: boolean;
  tipHandlers?: TipHandlers;
}) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const { logout } = useAuth();
  const live = LIVE_LABEL[realtime];
  const displayName = user?.name?.trim() || user?.email || "…";
  const avatar = (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-muted text-xs font-semibold text-accent-strong">
      {user ? initialsFor(user.name, user.email) : "…"}
      {compact && (
        <span aria-hidden className={cn("absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-2 border-sidebar", live.dot)} />
      )}
    </span>
  );

  return (
    <span data-tip={compact ? `${displayName} · ${live.label}` : undefined} {...tipHandlers} className={cn(!compact && "min-w-0 flex-1")}>
      <DropdownMenu
        label={compact ? `Account menu. ${live.label}` : "Account menu"}
        align="start"
        panelClassName="w-[220px] p-1"
        triggerClassName={cn(
          "flex items-center rounded-md text-left hover:bg-surface-raised",
          compact ? "p-1.5" : "w-full min-w-0 gap-2 p-1",
        )}
        trigger={
          compact ? (
            avatar
          ) : (
            <>
              {avatar}
              <span className="flex min-w-0 flex-col leading-tight">
                <strong className="truncate text-meta font-medium text-ink">{displayName}</strong>
                <LiveIndicator realtime={realtime} />
              </span>
            </>
          )
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
            <MenuLink href="/settings#ps-account" icon={<UserRound size={15} />} label="Profile" />
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
    </span>
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
 * followed until the user picks). `withLabel` adds the words, for the phone
 * More sheet. */
export function ThemeButton({ withLabel = false }: { withLabel?: boolean }) {
  const { theme, setPreference, mounted } = useTheme();
  const isDark = mounted && theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={withLabel ? undefined : label}
      title={label}
      className={cn(
        "shrink-0 items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink",
        withLabel
          ? "inline-flex h-9 gap-2 border border-border bg-surface px-3 text-sm text-ink"
          : "grid h-[30px] w-[30px] place-items-center",
      )}
    >
      {isDark ? <Sun aria-hidden size={16} /> : <Moon aria-hidden size={16} />}
      {withLabel && (isDark ? "Light theme" : "Dark theme")}
    </button>
  );
}
