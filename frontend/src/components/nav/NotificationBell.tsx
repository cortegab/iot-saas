"use client";

import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Renders through the shared `DropdownMenu` shell rather than its own
 * `absolute`-positioned panel — see the note on `UserMenu`, which had the
 * same duplicated-and-clippable pattern before both were consolidated. */
export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <DropdownMenu
      label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      panelClassName="flex max-h-96 w-80 flex-col overflow-hidden"
      triggerClassName="relative rounded-md p-2 text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      trigger={
        <>
          <Bell aria-hidden size={18} />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-[10px] font-medium text-white"
            >
              {badgeLabel}
            </span>
          )}
        </>
      }
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-ink">Notifications</span>
        {unreadCount > 0 && (
          <button type="button" onClick={() => void markAllRead()} className="text-xs text-accent">
            Mark all as read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {notifications.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">Nothing yet — rule firings show up here.</p>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li key={n.id} className="flex gap-2 border-b border-border px-4 py-3 last:border-b-0">
                <Badge
                  tone={n.read_at == null ? "pending" : "unknown"}
                  variant="indicator"
                  label={n.read_at == null ? "Unread" : "Read"}
                  className={n.read_at == null ? "mt-1.5" : "mt-1.5 opacity-0"}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-ink">{n.message}</span>
                  <span className="text-xs text-ink-muted">{timeAgo(n.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DropdownMenu>
  );
}
