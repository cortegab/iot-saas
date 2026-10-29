"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, Bell, Check, CheckCheck, Info, Mail, X, Zap } from "lucide-react";
import { NOTIFICATIONS_KEY, refreshNotifications, useNotificationActions, useNotificationSummary } from "@/hooks/useNotifications";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { FilterChips, ListToolbar, type FilterChip, type QuickFilterOption } from "@/components/list/ListToolbar";
import { NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { useListState } from "@/components/list/useListState";
import { clampPage } from "@/components/list/usePager";
import { pageKey, useServerPager } from "@/components/list/useServerPager";
import { ApiRequestError, type ApiPage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatWhen, timeAgo } from "@/lib/time-ago";
import type { components, operations } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type NotificationResponse = components["schemas"]["NotificationResponse"];
/** Repeats of one alert from one source, as one row (DESIGN.md §8); grouped by the API. */
type AlertGroup = components["schemas"]["NotificationGroupResponse"];
type NotificationType = NonNullable<NonNullable<operations["list_groups_notifications_groups_get"]["parameters"]["query"]>["type"]>;
type Severity = NotificationResponse["severity"];

const SEVERITY: Record<Severity, { icon: typeof Bell; label: string; tone: string }> = {
  critical: { icon: AlertTriangle, label: "Critical", tone: "text-status-error" },
  warning: { icon: Zap, label: "Warning", tone: "text-status-pending" },
  info: { icon: Info, label: "Info", tone: "text-ink-muted" },
};
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/** The state filter's types (DESIGN.md §8): what someone scans for. A rule
 * firing and its clearing are both "Rules". */
const TYPES: { value: NotificationType; label: string; hint: string; tone: QuickFilterOption["tone"]; alert?: boolean }[] = [
  { value: "device_offline", label: "Offline", hint: "Devices that went offline, not read yet", tone: "offline", alert: true },
  { value: "rules", label: "Rules", hint: "Rules that fired or cleared, not read yet", tone: "pending" },
  { value: "rule_health", label: "Rule health", hint: "Rules that stopped working, not read yet", tone: "error", alert: true },
  { value: "delivery_failed", label: "Failed deliveries", hint: "Emails and webhooks that failed, not read yet", tone: "error", alert: true },
  { value: "template_changed", label: "Templates", hint: "Template changes, not read yet", tone: "unknown" },
];
const isType = (v: string): v is NotificationType => TYPES.some((t) => t.value === v);

/** Notifications (DESIGN.md §8, demo H; the phone tab bar says "Alerts"):
 * one Line row per alert, repeats grouped (×4, "since …, last …"), filters
 * for type, severity, device and rule, paged like every list (§6). The API
 * groups, filters and pages, so counts and pages cover the whole feed. A row
 * opens a sheet with the details, the links and each time it happened; the
 * row menu marks read / unread or dismisses (with Undo). Acknowledge and the
 * Active / Acknowledged / Cleared lifecycle wait for their backend (§13). */
export default function NotificationsPage() {
  const toast = useToast();
  const api = useApi();
  const { summary, error: summaryError } = useNotificationSummary();
  const { markAllRead, markRead, markUnread, dismiss, restore } = useNotificationActions();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  // `state`: all, unread, or a type (its unread alerts).
  const list = useListState({ state: "all", severity: "all", device: "all", rule: "all" });
  const [open, setOpen] = useState<AlertGroup | null>(null);

  const deviceName = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d.name])), [devices]);
  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);
  const templateName = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t.name])), [templates]);

  // Only devices and rules that have alerts are offered as filters.
  const deviceOptions = (summary?.device_ids ?? []).map((id) => ({ id, name: deviceName.get(id) ?? "Deleted device" }));
  const ruleOptions = (summary?.rule_ids ?? []).map((id) => ({ id, name: ruleName.get(id) ?? "Deleted rule" }));

  const f = list.filters;
  const all = (v: string) => (v === "all" ? null : v);
  const key = pageKey(`${NOTIFICATIONS_KEY}/groups`, list.page, list.pageSize, {
    unread: f.state === "all" ? null : "true",
    type: isType(f.state) ? f.state : null,
    severity: all(f.severity),
    device_id: all(f.device),
    rule_id: all(f.rule),
    q: list.q.trim() || null,
  });
  const { data, error, isLoading } = useSWR<ApiPage<AlertGroup>>(key, () => api.getPage<AlertGroup>(key), {
    refreshInterval: 30_000,
    keepPreviousData: true,
  });
  const groups = data?.items ?? [];
  const total = data?.total ?? 0;
  const { page, pageCount } = clampPage(list.page, total, list.pageSize);
  // The last alert on the last page was dismissed: step back a page.
  useEffect(() => {
    if (data && list.page > pageCount) list.setPage(pageCount);
  }, [data, list, pageCount]);

  async function onDismiss(g: AlertGroup) {
    try {
      const ids = await dismiss(g.key);
      if (open?.key === g.key) setOpen(null);
      toast({
        title: ids.length > 1 ? `${ids.length} notifications dismissed` : "Notification dismissed",
        action: { label: "Undo", onClick: () => void restore(ids) },
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't dismiss it", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  function openSheet(g: AlertGroup) {
    setOpen(g);
    if (g.unread_count > 0) void markRead(g.key);
  }

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") });
  if (f.severity !== "all") chips.push({ id: "severity", label: `Severity: ${SEVERITY[f.severity as Severity]?.label}`, onRemove: () => list.setFilter("severity", "all") });
  if (f.device !== "all") chips.push({ id: "device", label: `Device: ${deviceName.get(f.device) ?? "unknown"}`, onRemove: () => list.setFilter("device", "all") });
  if (f.rule !== "all") chips.push({ id: "rule", label: `Rule: ${ruleName.get(f.rule) ?? "unknown"}`, onRemove: () => list.setFilter("rule", "all") });

  const unreadTotal = summary?.unread ?? 0;
  const markAllButton = (
    <Button variant="secondary" disabled={unreadTotal === 0} onClick={() => void markAllRead().then(() => toast({ title: "All notifications marked as read" }))}>
      <CheckCheck aria-hidden size={15} />
      Mark all as read
    </Button>
  );
  const loadError = summaryError ?? error;
  const empty = summary?.alerts === 0;

  return (
    <>
      {/* DESIGN.md §6: the action lives in the toolbar; the header holds it
          only while there's no toolbar (loading, error, nothing yet). */}
      <PageHeader
        inline
        title="Notifications"
        description="Alarms that need someone, and what happened. Open one for its details and links."
        actions={!loadError && summary && !empty ? undefined : markAllButton}
      />

      {loadError ? (
        <ErrorState
          title="Couldn't load notifications"
          message={loadError instanceof ApiRequestError ? loadError.message : "The API didn't respond."}
          onRetry={() => void refreshNotifications()}
        />
      ) : !summary || (isLoading && !data) ? (
        <LoadingSkeleton rows={4} rowClassName="h-16" />
      ) : empty ? (
        <EmptyState icon={<Bell aria-hidden size={26} />} title="Nothing needs attention" description="No alerts. New ones appear here, with a count in the sidebar." />
      ) : (
        <>
          {/* The state filter: unread alerts by type. Unread stands in for
              "not acknowledged" until alarms have a lifecycle (DESIGN.md §13). */}
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder="Search notifications"
            activeFilters={[f.severity, f.device, f.rule].filter((v) => v !== "all").length}
            actions={markAllButton}
            quick={{
              label: "Filter by state",
              value: f.state,
              onChange: (v) => list.setFilter("state", v),
              options: [
                { value: "all", label: "All", count: summary.alerts },
                { value: "unread", label: "Unread", count: unreadTotal, tone: "accent", hint: "Not read yet" },
                ...TYPES.map((t) => ({ ...t, count: summary.unread_by_type[t.value] ?? 0 })),
              ],
            }}
          >
            <Select aria-label="Filter by severity" value={f.severity} onChange={(e) => list.setFilter("severity", e.target.value)} className="w-auto">
              <option value="all">All severities</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].label}
                </option>
              ))}
            </Select>
            {deviceOptions.length > 0 && (
              <Select aria-label="Filter by device" value={f.device} onChange={(e) => list.setFilter("device", e.target.value)} className="w-auto">
                <option value="all">All devices</option>
                {deviceOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            {ruleOptions.length > 0 && (
              <Select aria-label="Filter by rule" value={f.rule} onChange={(e) => list.setFilter("rule", e.target.value)} className="w-auto">
                <option value="all">All rules</option>
                {ruleOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </ListToolbar>
          <FilterChips chips={chips} onClearAll={list.clearAll} />
          {total === 0 ? (
            f.state !== "all" && chips.length === 0 ? (
              <EmptyState icon={<Check aria-hidden size={26} />} title="Nothing unread" description={f.state === "unread" ? "Every notification has been read." : "Nothing of this type is waiting to be read."} />
            ) : (
              <NoResults noun="notifications" onClear={list.clearAll} />
            )
          ) : (
            <div className="flex flex-col gap-2">
              {/* demo H rows: a bare severity icon, one column (title, muted
                  detail, small meta with links), the state and its action on
                  the right. The whole row opens the sheet. */}
              <ul aria-label="Alerts" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
                {groups.map((g) => {
                  const n = g.latest;
                  const sev = SEVERITY[n.severity];
                  const SevIcon = n.kind === "delivery_failed" ? Mail : sev.icon;
                  const unread = g.unread_count > 0;
                  return (
                    <li
                      key={g.key}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a, button")) openSheet(g);
                      }}
                      className={cn(
                        "flex cursor-pointer items-start gap-x-3 gap-y-2 border-t border-border-soft px-3.5 py-2.5 first:border-t-0 hover:bg-row-hover",
                        // Unread: the demo's active bar on the left edge.
                        unread && "shadow-[inset_3px_0_0_var(--color-accent)]",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 basis-[260px] items-start gap-3">
                        <SevIcon aria-hidden size={17} className={cn("mt-0.5 shrink-0", sev.tone)} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                          <button type="button" onClick={() => openSheet(g)} aria-haspopup="dialog" className="min-w-0 text-left text-ink">
                            <span className="sr-only">{sev.label}{unread ? ", Unread" : ""}: </span>
                            {/* Unread is the accent bar and a bold title (DESIGN.md §8). */}
                            <strong className={unread ? "font-semibold" : "font-normal"}>{n.message}</strong>
                            {g.count > 1 && (
                              <Tag size="sm" className="ml-2">
                                ×{g.count}
                              </Tag>
                            )}
                          </button>
                          {n.detail && <span className="text-xs text-ink-muted">{n.detail}</span>}
                          <span className="text-xs text-ink-muted">
                            {g.count > 1 ? `since ${formatWhen(g.first_at)}, last ${timeAgo(g.last_at)}` : timeAgo(g.last_at)}
                            <SourceLinks n={n} deviceName={deviceName} ruleName={ruleName} templateName={templateName} />
                          </span>
                        </div>
                      </div>
                      <div className="ml-auto shrink-0">
                        <DropdownMenu
                          label={`Actions for ${n.message}`}
                          groups={[
                            [
                              unread
                                ? { label: "Mark as read", icon: <Check size={15} />, onClick: () => void markRead(g.key) }
                                : { label: "Mark as unread", icon: <Bell size={15} />, onClick: () => void markUnread(g.key) },
                            ],
                            [{ label: "Dismiss", icon: <X size={15} />, danger: true, onClick: () => void onDismiss(g) }],
                          ]}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <TableFooter
                shown={total}
                total={total}
                noun={["alert", "alerts"]}
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

      <ItemSheet
        open={open != null}
        onClose={() => setOpen(null)}
        title={open?.latest.message ?? "Notification"}
        sub={open ? `${SEVERITY[open.latest.severity].label}${open.count > 1 ? ` · ${open.count} times` : ""}` : undefined}
        footer={
          open ? (
            <>
              <Button variant="link-danger" className="mr-auto text-meta" onClick={() => void onDismiss(open)}>
                Dismiss
              </Button>
              <Button variant="ghost" onClick={() => void markUnread(open.key)}>
                Mark as unread
              </Button>
              <Button onClick={() => setOpen(null)}>Done</Button>
            </>
          ) : undefined
        }
      >
        {open && (
          <div className="flex flex-col gap-4">
            {open.latest.detail && <p className="text-sm text-ink">{open.latest.detail}</p>}
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              {open.latest.device_id && (
                <>
                  <dt className="text-ink-muted">Device</dt>
                  <dd>{deviceName.has(open.latest.device_id) ? <Link href={`/devices/${open.latest.device_id}`} className="text-accent hover:underline">{deviceName.get(open.latest.device_id)}</Link> : "Deleted device"}</dd>
                </>
              )}
              {open.latest.rule_id && (
                <>
                  <dt className="text-ink-muted">Rule</dt>
                  <dd>{ruleName.has(open.latest.rule_id) ? <Link href={`/rules/${open.latest.rule_id}`} className="text-accent hover:underline">{ruleName.get(open.latest.rule_id)}</Link> : "Deleted rule"}</dd>
                </>
              )}
              {open.latest.catalog_entry_id && (
                <>
                  <dt className="text-ink-muted">Template</dt>
                  <dd>{templateName.has(open.latest.catalog_entry_id) ? <Link href={`/templates/${open.latest.catalog_entry_id}`} className="text-accent hover:underline">{templateName.get(open.latest.catalog_entry_id)}</Link> : "Deleted template"}</dd>
                </>
              )}
              <dt className="text-ink-muted">{open.count > 1 ? "First" : "When"}</dt>
              <dd>{formatWhen(open.first_at)}</dd>
              {open.count > 1 && (
                <>
                  <dt className="text-ink-muted">Last</dt>
                  <dd>
                    {formatWhen(open.last_at)} · {open.count} times
                  </dd>
                </>
              )}
            </dl>
            {open.count > 1 && <EachTime groupKey={open.key} />}
          </div>
        )}
      </ItemSheet>
    </>
  );
}

/** Each time one alert happened, newest first, paged by the API. */
function EachTime({ groupKey }: { groupKey: string }) {
  const pager = useServerPager<NotificationResponse>(`${NOTIFICATIONS_KEY}/groups/${encodeURIComponent(groupKey)}/items`);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-meta font-medium text-ink-muted">Each time</h3>
      <ol aria-label="Each time" className="flex flex-col gap-1.5 border-l-2 border-border pl-3.5 text-meta">
        {pager.rows.map((n) => (
          <li key={n.id} className="tabular-nums text-ink">
            {formatWhen(n.created_at)}
          </li>
        ))}
      </ol>
      <TableFooter shown={pager.total} total={pager.total} noun={["time", "times"]} page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} onPage={pager.setPage} onPageSize={pager.setPageSize} />
    </div>
  );
}

/** " · {device} · rule {rule} · {template}" as links to each (demo H). */
function SourceLinks({
  n,
  deviceName,
  ruleName,
  templateName,
}: {
  n: NotificationResponse;
  deviceName: Map<string, string>;
  ruleName: Map<string, string>;
  templateName: Map<string, string>;
}) {
  const link = (href: string, text: string) => (
    <Link href={href} className="text-ink-muted underline-offset-[3px] hover:text-accent hover:underline">
      {text}
    </Link>
  );
  return (
    <>
      {n.device_id && <> · {deviceName.has(n.device_id) ? link(`/devices/${n.device_id}`, deviceName.get(n.device_id)!) : "deleted device"}</>}
      {n.rule_id && <> · rule {ruleName.has(n.rule_id) ? link(`/rules/${n.rule_id}`, ruleName.get(n.rule_id)!) : "deleted"}</>}
      {n.catalog_entry_id && templateName.has(n.catalog_entry_id) && <> · {link(`/templates/${n.catalog_entry_id}`, templateName.get(n.catalog_entry_id)!)}</>}
    </>
  );
}
