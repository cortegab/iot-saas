"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { AlertTriangle, Bell, Check, CheckCheck, Info, Mail, X, Zap } from "lucide-react";
import { NOTIFICATIONS_KEY, useNotifications } from "@/hooks/useNotifications";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, useListState } from "@/components/list/useListState";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type Severity = components["schemas"]["NotificationResponse"]["severity"];

const SEVERITY: Record<Severity, { icon: typeof Bell; label: string; className: string }> = {
  critical: { icon: AlertTriangle, label: "Critical", className: "bg-status-error-surface text-status-error" },
  warning: { icon: Zap, label: "Warning", className: "bg-status-pending-surface text-status-pending" },
  info: { icon: Info, label: "Info", className: "bg-surface-raised text-ink-muted" },
};

/** The notification feed (demo G): what rules and devices reported, by
 * severity, with links to the device page, rule or template. Opening a link
 * marks it read; Dismiss removes it with an Undo. */
export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const { notifications, unreadCount, isLoading, error, markAllRead, markRead, markUnread, dismiss, restore } = useNotifications();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const list = useListState({ show: "all" });

  const deviceName = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d.name])), [devices]);
  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);
  const templateName = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t.name])), [templates]);

  const filtered = useMemo(
    () =>
      notifications.filter(
        (n) =>
          (list.filters.show === "all" || n.read_at == null) &&
          matchesQuery(
            list.q,
            n.message,
            n.detail,
            n.device_id ? deviceName.get(n.device_id) : null,
            n.rule_id ? ruleName.get(n.rule_id) : null,
            n.catalog_entry_id ? templateName.get(n.catalog_entry_id) : null,
          ),
      ),
    [notifications, list.filters.show, list.q, deviceName, ruleName, templateName],
  );

  async function onDismiss(id: string) {
    try {
      await dismiss(id);
      toast({
        title: "Notification dismissed",
        action: { label: "Undo", onClick: () => void restore(id) },
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't dismiss it", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }
  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  async function open(id: string, read: boolean, href: string) {
    if (!read) void markRead(id);
    router.push(href);
  }

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What rules, devices and templates reported. Links open the related device, rule or template."
        actions={
          <Button
            variant="secondary"
            disabled={unreadCount === 0}
            onClick={() =>
              void markAllRead().then(() => toast({ title: "All notifications marked as read" }))
            }
          >
            <CheckCheck aria-hidden size={15} />
            Mark all as read
          </Button>
        }
      />

      {error ? (
        <ErrorState
          title="Couldn't load notifications"
          message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
          onRetry={() => void revalidate(NOTIFICATIONS_KEY)}
        />
      ) : isLoading ? (
        <LoadingSkeleton rows={4} rowClassName="h-16" />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell aria-hidden size={26} />}
          title="You're all caught up"
          description="New alerts from rules and devices appear here, with a count in the sidebar."
        />
      ) : (
        <>
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder="Search notifications"
            quick={{
              label: "Show",
              value: list.filters.show,
              onChange: (v) => list.setFilter("show", v),
              options: [
                { value: "all", label: "All", count: notifications.length },
                { value: "unread", label: "Unread", count: unreadCount },
              ],
            }}
          />
          <FilterChips chips={chips} onClearAll={list.clearAll} />
          {filtered.length === 0 ? (
            list.filters.show === "unread" && !list.q ? (
              <EmptyState icon={<Check aria-hidden size={26} />} title="Nothing unread" description="Every notification has been read." />
            ) : (
              <NoResults noun="notifications" onClear={list.clearAll} />
            )
          ) : (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                {pageRows.map((n) => {
                  const unread = n.read_at == null;
                  const dev = n.device_id ? deviceName.get(n.device_id) : null;
                  const rule = n.rule_id ? ruleName.get(n.rule_id) : null;
                  const sev = SEVERITY[n.severity];
                  const SevIcon = n.kind === "delivery_failed" ? Mail : sev.icon;
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex items-start gap-3 border-b border-border-soft px-4 py-3.5 last:border-b-0",
                        unread && "bg-accent/[0.04]",
                      )}
                    >
                      <span title={sev.label} className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md", sev.className)}>
                        <SevIcon aria-hidden size={16} />
                        <span className="sr-only">{sev.label}</span>
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                        <p className="text-ink">
                          {unread && (
                            <span aria-label="Unread" className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle" />
                          )}
                          <strong className="font-medium">{n.message}</strong>
                        </p>
                        {n.detail && <span className="text-[13.5px] text-ink">{n.detail}</span>}
                        {(dev || rule) && (
                          <span className="text-[13.5px] text-ink-muted">{[dev, rule && `rule ${rule}`].filter(Boolean).join(" · ")}</span>
                        )}
                        <span className="mt-1 flex gap-3.5">
                          {n.device_id && (
                            <button type="button" className="text-sm text-accent hover:underline" onClick={() => void open(n.id, !unread, `/devices/${n.device_id}`)}>
                              Open device
                            </button>
                          )}
                          {n.rule_id && (
                            <button type="button" className="text-sm text-accent hover:underline" onClick={() => void open(n.id, !unread, `/rules/${n.rule_id}`)}>
                              Open rule
                            </button>
                          )}
                          {n.catalog_entry_id && templateName.has(n.catalog_entry_id) && (
                            <button
                              type="button"
                              className="text-sm text-accent hover:underline"
                              onClick={() => void open(n.id, !unread, `/templates/${n.catalog_entry_id}`)}
                            >
                              Open template
                            </button>
                          )}
                        </span>
                      </div>
                      <span className="whitespace-nowrap text-[12.5px] text-ink-muted" title={new Date(n.created_at).toLocaleString()}>
                        {timeAgo(n.created_at)}
                      </span>
                      <DropdownMenu
                        label={`Actions for ${n.message}`}
                        groups={[
                          [
                            unread
                              ? { label: "Mark as read", icon: <Check size={15} />, onClick: () => void markRead(n.id) }
                              : { label: "Mark as unread", icon: <Bell size={15} />, onClick: () => void markUnread(n.id) },
                          ],
                          [{ label: "Dismiss", icon: <X size={15} />, danger: true, onClick: () => void onDismiss(n.id) }],
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
              <TableFooter
                shown={filtered.length}
                total={notifications.length}
                noun={["notification", "notifications"]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
