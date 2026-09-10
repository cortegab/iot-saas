"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { NOTIFICATIONS_KEY, useNotifications } from "@/hooks/useNotifications";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type NotificationResponse = components["schemas"]["NotificationResponse"];

export default function NotificationsPage() {
  const router = useRouter();
  const { notifications, unreadCount, isLoading, error, markAllRead, markRead } = useNotifications();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const [filter, setFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");

  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices ?? []) map.set(d.id, d.name);
    return map;
  }, [devices]);

  const deviceOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const n of notifications) if (n.device_id) ids.add(n.device_id);
    return Array.from(ids, (id) => ({ value: id, label: deviceNameById.get(id) ?? id }));
  }, [notifications, deviceNameById]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return notifications.filter((n) => {
      if (deviceFilter !== "all" && n.device_id !== deviceFilter) return false;
      if (!q) return true;
      const deviceName = n.device_id ? (deviceNameById.get(n.device_id) ?? "") : "";
      return n.message.toLowerCase().includes(q) || deviceName.toLowerCase().includes(q);
    });
  }, [notifications, filter, deviceFilter, deviceNameById]);

  const columns: TableColumn<NotificationResponse>[] = [
    {
      header: "Notification",
      render: (n) => {
        const dev = n.device_id ? deviceNameById.get(n.device_id) : null;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-ink">{n.message}</span>
            <span className="text-xs text-ink-muted">
              {[dev, timeAgo(n.created_at)].filter(Boolean).join(" · ")}
            </span>
          </div>
        );
      },
    },
    {
      header: "Status",
      render: (n) => (
        <Badge
          tone={n.read_at == null ? "pending" : "unknown"}
          variant="dot"
          label={n.read_at == null ? "Unread" : "Read"}
        />
      ),
    },
    {
      header: "",
      className: "w-10 text-right",
      render: (n) => {
        const primary: DropdownMenuItem[] = [];
        if (n.device_id) {
          primary.push({ label: "View Device", onClick: () => router.push(`/devices/${n.device_id}`) });
        }
        if (n.rule_id) {
          primary.push({ label: "View Rule", onClick: () => router.push(`/rules/${n.rule_id}`) });
        }
        const items: DropdownMenuItem[][] = [];
        if (primary.length > 0) items.push(primary);
        if (n.read_at == null) items.push([{ label: "Mark as Read", onClick: () => void markRead(n.id) }]);
        return items.length > 0 ? <DropdownMenu groups={items} label="Actions" /> : null;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        actions={
          unreadCount > 0 && (
            <Button type="button" variant="ghost" onClick={() => void markAllRead()}>
              Mark all as read
            </Button>
          )
        }
      />

      {notifications.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            compact
            className="bg-surface"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by message or device…"
          />
          <Select
            compact
            className="bg-surface"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
          >
            <option value="all">All devices</option>
            {deviceOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isLoading && <LoadingSkeleton rows={4} rowClassName="h-16" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load notifications."}
          onRetry={() => void revalidate(NOTIFICATIONS_KEY)}
        />
      )}

      {!isLoading && !error && notifications.length === 0 && (
        <EmptyState title="Nothing yet" description="Rule firings show up here." />
      )}

      {notifications.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matching notifications" description="Try a different search term or device filter." />
      )}

      {filtered.length > 0 && <Table columns={columns} rows={filtered} rowKey={(n) => n.id} />}
    </div>
  );
}
