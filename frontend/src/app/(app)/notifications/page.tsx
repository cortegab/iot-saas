"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Bell, Check, CheckCheck } from "lucide-react";
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

/** The notification feed (demo G): what rules and devices reported, with
 * links to the device page or the rule. Opening a link marks it read. */
export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const { notifications, unreadCount, isLoading, error, markAllRead, markRead } = useNotifications();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const list = useListState({ show: "all" });

  const deviceName = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d.name])), [devices]);
  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);

  const filtered = useMemo(
    () =>
      notifications.filter(
        (n) =>
          (list.filters.show === "all" || n.read_at == null) &&
          matchesQuery(list.q, n.message, n.device_id ? deviceName.get(n.device_id) : null, n.rule_id ? ruleName.get(n.rule_id) : null),
      ),
    [notifications, list.filters.show, list.q, deviceName, ruleName],
  );
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
        description="What rules and devices reported. Links open the related device page or rule."
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
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex items-start gap-3 border-b border-border-soft px-4 py-3.5 last:border-b-0",
                        unread && "bg-accent/[0.04]",
                      )}
                    >
                      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md bg-surface-raised text-ink-muted">
                        <Bell size={16} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                        <p className="text-ink">
                          {unread && (
                            <span aria-label="Unread" className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle" />
                          )}
                          <strong className="font-medium">{n.message}</strong>
                        </p>
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
                        </span>
                      </div>
                      <span className="whitespace-nowrap text-[12.5px] text-ink-muted" title={new Date(n.created_at).toLocaleString()}>
                        {timeAgo(n.created_at)}
                      </span>
                      <DropdownMenu
                        label="Actions"
                        groups={[
                          unread
                            ? [{ label: "Mark as read", icon: <Check size={15} />, onClick: () => void markRead(n.id) }]
                            : [{ label: "Already read", disabled: true, onClick: () => {} }],
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
