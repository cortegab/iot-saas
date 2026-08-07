"use client";

import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative rounded-md p-2 text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-[10px] font-medium text-white"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-outside dismiss, matching a plain overlay rather than a
              focus-trap library — this panel has no nested interactive
              controls beyond "mark all as read" and the list itself. */}
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 flex max-h-96 w-80 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-medium text-ink">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-xs text-accent"
                >
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
                    <li
                      key={n.id}
                      className="flex gap-2 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          n.read_at == null ? "bg-accent" : "bg-transparent"
                        }`}
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
          </div>
        </>
      )}
    </div>
  );
}
