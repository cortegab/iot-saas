"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, Bell, Check, CheckCheck, Info, Mail, X, Zap } from "lucide-react";
import { NOTIFICATIONS_KEY, refreshNotifications, useNotificationActions, useNotificationSummary } from "@/hooks/useNotifications";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { Input } from "@/components/ui/Input";
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
import { tActive as t } from "@iodriven/shared/i18n";
import { notificationText } from "@iodriven/shared/notification-text";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type NotificationResponse = components["schemas"]["NotificationResponse"];
/** Repeats of one alert from one source, as one row (DESIGN.md §8); grouped by the API. */
type AlertGroup = components["schemas"]["NotificationGroupResponse"];
type NotificationType = NonNullable<NonNullable<operations["list_groups_notifications_groups_get"]["parameters"]["query"]>["type"]>;
type Severity = NotificationResponse["severity"];
type MemberResponse = components["schemas"]["MemberResponse"];

/** The alarm state of an alert (DESIGN.md §13), in words: who is on it, or
 * that its condition went away. Null while it's active. */
function alarmState(n: NotificationResponse, who: (id: string | null | undefined) => string): string | null {
  if (n.cleared_at) return t("alerts.cleared", { ago: timeAgo(n.cleared_at) });
  if (n.acknowledged_at)
    return `${t("alerts.acknowledgedBy", { who: who(n.acknowledged_by), ago: timeAgo(n.acknowledged_at) })}${n.acknowledged_note ? `: “${n.acknowledged_note}”` : ""}`;
  return null;
}

const SEVERITY: Record<Severity, { icon: typeof Bell; label: string; tone: string }> = {
  critical: { icon: AlertTriangle, get label() { return t("alerts.severity.critical"); }, tone: "text-status-error" },
  warning: { icon: Zap, get label() { return t("alerts.severity.warning"); }, tone: "text-status-pending" },
  info: { icon: Info, get label() { return t("alerts.severity.info"); }, tone: "text-ink-muted" },
};
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/** The state filter's types (DESIGN.md §8): what someone scans for. A rule
 * firing and its clearing are both "Rules". */
const TYPES: { value: NotificationType; label: string; hint: string; tone: QuickFilterOption["tone"]; alert?: boolean }[] = [
  { value: "device_offline", get label() { return t("alerts.types.device_offline"); }, get hint() { return t("alerts.types.device_offlineHint"); }, tone: "offline", alert: true },
  { value: "device_health", get label() { return t("alerts.types.device_health"); }, get hint() { return t("alerts.types.device_healthHint"); }, tone: "error", alert: true },
  { value: "rules", get label() { return t("alerts.types.rules"); }, get hint() { return t("alerts.types.rulesHint"); }, tone: "pending" },
  { value: "rule_health", get label() { return t("alerts.types.rule_health"); }, get hint() { return t("alerts.types.rule_healthHint"); }, tone: "error", alert: true },
  { value: "delivery_failed", get label() { return t("alerts.types.delivery_failed"); }, get hint() { return t("alerts.types.delivery_failedHint"); }, tone: "error", alert: true },
  { value: "template_changed", get label() { return t("alerts.types.template_changed"); }, get hint() { return t("alerts.types.template_changedHint"); }, tone: "unknown" },
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
  const { markAllRead, markRead, markUnread, dismiss, restore, acknowledge } = useNotificationActions();
  // Owners and admins acknowledge and dismiss; everyone reads (DESIGN.md §13).
  const canManage = usePermissions().can("alerts.manage");
  const { data: me } = useCurrentUser();
  const { data: members } = useApiSWR<MemberResponse[]>("/tenants/members");
  const who = (id: string | null | undefined) => {
    if (!id) return "someone";
    if (id === me?.id) return "you";
    const m = members?.find((x) => x.user_id === id);
    return m ? m.name || m.email : "someone";
  };
  const [ackNote, setAckNote] = useState("");

  async function onAcknowledge(g: AlertGroup, note?: string) {
    try {
      await acknowledge(g.key, note);
      setAckNote("");
      toast({ title: t("alerts.acknowledged"), detail: t("alerts.acknowledgedDetail") });
    } catch (err) {
      toast({ tone: "error", title: t("alerts.ackFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }
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
  const deviceOptions = (summary?.device_ids ?? []).map((id) => ({ id, name: deviceName.get(id) ?? t("alerts.deletedDevice") }));
  const ruleOptions = (summary?.rule_ids ?? []).map((id) => ({ id, name: ruleName.get(id) ?? t("alerts.deletedRule") }));

  const f = list.filters;
  const all = (v: string) => (v === "all" ? null : v);
  const key = pageKey(`${NOTIFICATIONS_KEY}/groups`, list.page, list.pageSize, {
    unread: f.state === "all" || f.state === "active" ? null : "true",
    active: f.state === "active" ? "true" : null,
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
        title: ids.length > 1 ? t("alerts.dismissedMany", { count: ids.length }) : t("alerts.dismissedOne"),
        action: { label: t("devices.toast.undo"), onClick: () => void restore(ids) },
      });
    } catch (err) {
      toast({ tone: "error", title: t("alerts.dismissFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
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
    <Button variant="secondary" disabled={unreadTotal === 0} onClick={() => void markAllRead().then(() => toast({ title: t("alerts.allMarked") }))}>
      <CheckCheck aria-hidden size={15} />
      {t("alerts.markAll")}
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
        title={t("alerts.title")}
        description={t("alerts.description")}
        actions={!loadError && summary && !empty ? undefined : markAllButton}
      />

      {loadError ? (
        <ErrorState
          title={t("alerts.loadFailed")}
          message={loadError instanceof ApiRequestError ? loadError.message : t("devices.apiDown")}
          onRetry={() => void refreshNotifications()}
        />
      ) : !summary || (isLoading && !data) ? (
        <LoadingSkeleton rows={4} rowClassName="h-16" />
      ) : empty ? (
        <EmptyState icon={<Bell aria-hidden size={26} />} title={t("alerts.emptyTitle")} description={t("alerts.emptyBody")} />
      ) : (
        <>
          {/* The state filter: alarms that still need someone (not
              acknowledged, not cleared; DESIGN.md §13), unread, and unread by
              type. */}
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder={t("alerts.search")}
            activeFilters={[f.severity, f.device, f.rule].filter((v) => v !== "all").length}
            actions={markAllButton}
            quick={{
              label: t("alerts.filterState"),
              value: f.state,
              onChange: (v) => list.setFilter("state", v),
              options: [
                { value: "all", label: t("devices.all"), count: summary.alerts },
                { value: "active", label: t("alerts.needsAttention"), hint: t("alerts.needsAttentionHint") },
                { value: "unread", label: t("alerts.unread"), count: unreadTotal, tone: "accent", hint: t("alerts.unreadHint") },
                ...TYPES.map((t) => ({ ...t, count: summary.unread_by_type[t.value] ?? 0 })),
              ],
            }}
          >
            <Select aria-label={t("alerts.filterSeverity")} value={f.severity} onChange={(e) => list.setFilter("severity", e.target.value)} className="w-auto">
              <option value="all">{t("alerts.allSeverities")}</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].label}
                </option>
              ))}
            </Select>
            {deviceOptions.length > 0 && (
              <Select aria-label={t("alerts.filterDevice")} value={f.device} onChange={(e) => list.setFilter("device", e.target.value)} className="w-auto">
                <option value="all">{t("rules.allDevices")}</option>
                {deviceOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            {ruleOptions.length > 0 && (
              <Select aria-label={t("alerts.filterRule")} value={f.rule} onChange={(e) => list.setFilter("rule", e.target.value)} className="w-auto">
                <option value="all">{t("alerts.allRules")}</option>
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
              <EmptyState
                icon={<Check aria-hidden size={26} />}
                title={f.state === "active" ? t("alerts.emptyTitle") : t("alerts.nothingUnread")}
                description={
                  f.state === "active"
                    ? t("alerts.allHandled")
                    : f.state === "unread"
                      ? t("alerts.allRead")
                      : t("alerts.noneOfType")
                }
              />
            ) : (
              <NoResults noun="notifications" onClear={list.clearAll} />
            )
          ) : (
            <div className="flex flex-col gap-2">
              {/* demo H rows: a bare severity icon, one column (title, muted
                  detail, small meta with links), the state and its action on
                  the right. The whole row opens the sheet. */}
              <ul aria-label={t("alerts.list")} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
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
                            <span className="sr-only">{sev.label}{unread ? t("alerts.unreadPrefix") : ""}: </span>
                            {/* Unread is the accent bar and a bold title (DESIGN.md §8). */}
                            <strong className={unread ? "font-semibold" : "font-normal"}>{notificationText(n).message}</strong>
                            {g.count > 1 && (
                              <Tag size="sm" className="ml-2">
                                ×{g.count}
                              </Tag>
                            )}
                          </button>
                          {notificationText(n).detail && <span className="text-xs text-ink-muted">{notificationText(n).detail}</span>}
                          {alarmState(n, who) && (
                            <span className={cn("text-xs", n.cleared_at ? "text-status-online" : "text-ink-muted")}>{alarmState(n, who)}</span>
                          )}
                          <span className="text-xs text-ink-muted">
                            {g.count > 1 ? t("alerts.since", { first: formatWhen(g.first_at), ago: timeAgo(g.last_at) }) : timeAgo(g.last_at)}
                            <SourceLinks n={n} deviceName={deviceName} ruleName={ruleName} templateName={templateName} />
                          </span>
                        </div>
                      </div>
                      <div className="ml-auto shrink-0">
                        <DropdownMenu
                          label={t("devices.actionsFor", { name: notificationText(n).message })}
                          groups={[
                            [
                              unread
                                ? { label: t("alerts.markRead"), icon: <Check size={15} />, onClick: () => void markRead(g.key) }
                                : { label: t("alerts.markUnread"), icon: <Bell size={15} />, onClick: () => void markUnread(g.key) },
                              ...(canManage && n.severity !== "info" && !n.acknowledged_at && !n.cleared_at
                                ? [{ label: t("alerts.acknowledge"), icon: <CheckCheck size={15} />, onClick: () => void onAcknowledge(g) }]
                                : []),
                            ],
                            ...(canManage ? [[{ label: t("alerts.dismiss"), icon: <X size={15} />, danger: true, onClick: () => void onDismiss(g) }]] : []),
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
        title={open ? notificationText(open.latest).message : t("alerts.notification")}
        sub={open ? `${SEVERITY[open.latest.severity].label}${open.count > 1 ? ` · ${t("alerts.times", { count: open.count })}` : ""}` : undefined}
        footer={
          open ? (
            <>
              {canManage ? (
                <Button variant="link-danger" className="mr-auto text-meta" onClick={() => void onDismiss(open)}>
                  {t("alerts.dismiss")}
                </Button>
              ) : (
                <span className="mr-auto" />
              )}
              <Button variant="ghost" onClick={() => void markUnread(open.key)}>
                {t("alerts.markUnread")}
              </Button>
              {canManage && open.latest.severity !== "info" && !open.latest.acknowledged_at && !open.latest.cleared_at ? (
                <Button onClick={() => void onAcknowledge(open, ackNote).then(() => setOpen(null))}>{t("alerts.acknowledge")}</Button>
              ) : (
                <Button onClick={() => setOpen(null)}>{t("ui.done")}</Button>
              )}
            </>
          ) : undefined
        }
      >
        {open && (
          <div className="flex flex-col gap-4">
            {notificationText(open.latest).detail && <p className="text-sm text-ink">{notificationText(open.latest).detail}</p>}
            {alarmState(open.latest, who) ? (
              <p className={cn("text-sm", open.latest.cleared_at ? "text-status-online" : "text-ink-muted")}>{alarmState(open.latest, who)}</p>
            ) : (
              canManage &&
              open.latest.severity !== "info" && (
                <label className="flex flex-col gap-1 text-meta text-ink-muted">
                  {t("alerts.note")}
                  <Input value={ackNote} maxLength={500} placeholder={t("alerts.notePlaceholder")} onChange={(e) => setAckNote(e.target.value)} />
                </label>
              )
            )}
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              {open.latest.device_id && (
                <>
                  <dt className="text-ink-muted">{t("alerts.device")}</dt>
                  <dd>{deviceName.has(open.latest.device_id) ? <Link href={`/devices/${open.latest.device_id}`} className="text-accent hover:underline">{deviceName.get(open.latest.device_id)}</Link> : t("alerts.deletedDevice")}</dd>
                </>
              )}
              {open.latest.rule_id && (
                <>
                  <dt className="text-ink-muted">{t("alerts.rule")}</dt>
                  <dd>{ruleName.has(open.latest.rule_id) ? <Link href={`/rules/${open.latest.rule_id}`} className="text-accent hover:underline">{ruleName.get(open.latest.rule_id)}</Link> : t("alerts.deletedRule")}</dd>
                </>
              )}
              {open.latest.catalog_entry_id && (
                <>
                  <dt className="text-ink-muted">{t("alerts.template")}</dt>
                  <dd>{templateName.has(open.latest.catalog_entry_id) ? <Link href={`/templates/${open.latest.catalog_entry_id}`} className="text-accent hover:underline">{templateName.get(open.latest.catalog_entry_id)}</Link> : t("alerts.deletedTemplate")}</dd>
                </>
              )}
              <dt className="text-ink-muted">{open.count > 1 ? t("alerts.first") : t("alerts.when")}</dt>
              <dd>{formatWhen(open.first_at)}</dd>
              {open.count > 1 && (
                <>
                  <dt className="text-ink-muted">{t("alerts.last")}</dt>
                  <dd>
                    {formatWhen(open.last_at)} · {t("alerts.times", { count: open.count })}
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
      <ol aria-label={t("alerts.eachTime")} className="flex flex-col gap-1.5 border-l-2 border-border pl-3.5 text-meta">
        {pager.rows.map((n) => (
          <li key={n.id} className="tabular-nums text-ink">
            {formatWhen(n.created_at)}
          </li>
        ))}
      </ol>
      <TableFooter shown={pager.total} total={pager.total} noun={[t("alerts.timeOne"), t("alerts.timeMany")]} page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} onPage={pager.setPage} onPageSize={pager.setPageSize} />
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
      {n.device_id && <> · {deviceName.has(n.device_id) ? link(`/devices/${n.device_id}`, deviceName.get(n.device_id)!) : t("alerts.deletedDeviceLower")}</>}
      {n.rule_id && <> · {t("alerts.ruleLink")} {ruleName.has(n.rule_id) ? link(`/rules/${n.rule_id}`, ruleName.get(n.rule_id)!) : t("alerts.deleted")}</>}
      {n.catalog_entry_id && templateName.has(n.catalog_entry_id) && <> · {link(`/templates/${n.catalog_entry_id}`, templateName.get(n.catalog_entry_id)!)}</>}
    </>
  );
}
