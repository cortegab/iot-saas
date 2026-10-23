"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { mutate as revalidate } from "swr";
import { AlertTriangle, Bell, Check, CheckCheck, ChevronRight, Info, Mail, X, Zap } from "lucide-react";
import { NOTIFICATIONS_KEY, useNotifications } from "@/hooks/useNotifications";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
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
type NotificationResponse = components["schemas"]["NotificationResponse"];
type Severity = NotificationResponse["severity"];

const SEVERITY: Record<Severity, { icon: typeof Bell; label: string; className: string }> = {
  critical: { icon: AlertTriangle, label: "Critical", className: "bg-status-error-surface text-status-error" },
  warning: { icon: Zap, label: "Warning", className: "bg-status-pending-surface text-status-pending" },
  info: { icon: Info, label: "Info", className: "bg-surface-raised text-ink-muted" },
};
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/** Repeats of the same alert from the same source, as one row (DESIGN.md §8). */
interface AlertGroup {
  key: string;
  /** Newest first. */
  items: NotificationResponse[];
  latest: NotificationResponse;
  first: NotificationResponse;
  unread: boolean;
}

function groupRepeats(list: NotificationResponse[]): AlertGroup[] {
  const groups = new Map<string, NotificationResponse[]>();
  for (const n of [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const key = [n.kind, n.rule_id, n.device_id, n.catalog_entry_id, n.message].join("|");
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups].map(([key, items]) => ({
    key,
    items,
    latest: items[0],
    first: items[items.length - 1],
    unread: items.some((n) => n.read_at == null),
  }));
}

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Notifications (DESIGN.md §8, demo H; the phone tab bar says "Alerts"):
 * one Line row per alert, repeats grouped (×4, "since …, last …"), filters
 * for severity, device and rule. A row opens a sheet with the details and
 * the links; the row menu marks read / unread or dismisses (with Undo).
 * Acknowledge and the Active / Acknowledged / Cleared lifecycle wait for
 * their backend (§13). */
export default function NotificationsPage() {
  const toast = useToast();
  const { notifications, unreadCount, isLoading, error, markAllRead, markRead, markUnread, dismiss, restore } = useNotifications();
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const list = useListState({ show: "all", severity: "all", device: "all", rule: "all" });
  const [openKey, setOpenKey] = useState<string | null>(null);

  const deviceName = useMemo(() => new Map((devices ?? []).map((d) => [d.id, d.name])), [devices]);
  const ruleName = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r.name])), [rules]);
  const templateName = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t.name])), [templates]);

  // Only devices and rules that have alerts are offered as filters.
  const deviceOptions = useMemo(
    () => [...new Set(notifications.map((n) => n.device_id).filter((x): x is string => !!x))].map((id) => ({ id, name: deviceName.get(id) ?? "Deleted device" })),
    [notifications, deviceName],
  );
  const ruleOptions = useMemo(
    () => [...new Set(notifications.map((n) => n.rule_id).filter((x): x is string => !!x))].map((id) => ({ id, name: ruleName.get(id) ?? "Deleted rule" })),
    [notifications, ruleName],
  );

  const groups = useMemo(() => {
    const f = list.filters;
    const shown = notifications.filter(
      (n) =>
        (f.severity === "all" || n.severity === f.severity) &&
        (f.device === "all" || n.device_id === f.device) &&
        (f.rule === "all" || n.rule_id === f.rule) &&
        matchesQuery(
          list.q,
          n.message,
          n.detail,
          n.device_id ? deviceName.get(n.device_id) : null,
          n.rule_id ? ruleName.get(n.rule_id) : null,
          n.catalog_entry_id ? templateName.get(n.catalog_entry_id) : null,
        ),
    );
    return groupRepeats(shown).filter((g) => f.show === "all" || g.unread);
  }, [notifications, list.filters, list.q, deviceName, ruleName, templateName]);

  // Alerts waiting to be read, counted once per group of repeats.
  const kpis = useMemo(() => {
    const unread = groupRepeats(notifications).filter((g) => g.unread);
    return { critical: unread.filter((g) => g.latest.severity === "critical").length, warning: unread.filter((g) => g.latest.severity === "warning").length, unread: unread.length };
  }, [notifications]);

  const { pageRows, pageCount, page } = paginate(groups, list.page, list.pageSize);
  const open = groups.find((g) => g.key === openKey) ?? null;

  const readAll = (g: AlertGroup) => Promise.all(g.items.filter((n) => n.read_at == null).map((n) => markRead(n.id)));
  const unreadAll = (g: AlertGroup) => markUnread(g.latest.id);

  async function onDismiss(g: AlertGroup) {
    try {
      await Promise.all(g.items.map((n) => dismiss(n.id)));
      if (openKey === g.key) setOpenKey(null);
      toast({
        title: g.items.length > 1 ? `${g.items.length} notifications dismissed` : "Notification dismissed",
        action: { label: "Undo", onClick: () => void Promise.all(g.items.map((n) => restore(n.id))) },
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't dismiss it", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  function openSheet(g: AlertGroup) {
    setOpenKey(g.key);
    if (g.unread) void readAll(g);
  }

  const chips: FilterChip[] = [];
  if (list.q) chips.push({ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") });
  if (list.filters.severity !== "all")
    chips.push({ id: "severity", label: `Severity: ${SEVERITY[list.filters.severity as Severity]?.label}`, onRemove: () => list.setFilter("severity", "all") });
  if (list.filters.device !== "all")
    chips.push({ id: "device", label: `Device: ${deviceName.get(list.filters.device) ?? "unknown"}`, onRemove: () => list.setFilter("device", "all") });
  if (list.filters.rule !== "all")
    chips.push({ id: "rule", label: `Rule: ${ruleName.get(list.filters.rule) ?? "unknown"}`, onRemove: () => list.setFilter("rule", "all") });


  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alarms that need someone, and what happened. Open one for its details and links."
        actions={
          <Button variant="secondary" disabled={unreadCount === 0} onClick={() => void markAllRead().then(() => toast({ title: "All notifications marked as read" }))}>
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
        <EmptyState icon={<Bell aria-hidden size={26} />} title="Nothing needs attention" description="No alerts. New ones appear here, with a count in the sidebar." />
      ) : (
        <>
          {/* demo H: what's waiting, by severity. Unread stands in for "not
              acknowledged" until alarms have a lifecycle (DESIGN.md §13). */}
          <KpiStrip
            ariaLabel="Unread alerts"
            active={list.filters.show !== "unread" ? null : list.filters.severity !== "all" ? list.filters.severity : "unread"}
            onSelect={(id) => {
              const on = list.filters.show === "unread" && (id === "unread" ? list.filters.severity === "all" : list.filters.severity === id);
              list.setFilters({ show: on ? "all" : "unread", severity: on || id === "unread" ? "all" : id });
            }}
            items={[
              { id: "critical", label: "Critical, unread", value: kpis.critical, tone: "offline" },
              { id: "warning", label: "Warnings, unread", value: kpis.warning, tone: "pending" },
              { id: "unread", label: "Unread", value: kpis.unread, tone: "accent" },
            ]}
          />
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder="Search notifications"
            activeFilters={[list.filters.severity, list.filters.device, list.filters.rule].filter((v) => v !== "all").length}
            quick={{
              label: "Show",
              value: list.filters.show,
              onChange: (v) => list.setFilter("show", v),
              options: [
                { value: "all", label: "All", count: notifications.length },
                { value: "unread", label: "Unread", count: unreadCount },
              ],
            }}
          >
            <Select aria-label="Filter by severity" value={list.filters.severity} onChange={(e) => list.setFilter("severity", e.target.value)} className="w-auto">
              <option value="all">All severities</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].label}
                </option>
              ))}
            </Select>
            {deviceOptions.length > 0 && (
              <Select aria-label="Filter by device" value={list.filters.device} onChange={(e) => list.setFilter("device", e.target.value)} className="w-auto">
                <option value="all">All devices</option>
                {deviceOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            {ruleOptions.length > 0 && (
              <Select aria-label="Filter by rule" value={list.filters.rule} onChange={(e) => list.setFilter("rule", e.target.value)} className="w-auto">
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
          {groups.length === 0 ? (
            list.filters.show === "unread" && chips.length === 0 ? (
              <EmptyState icon={<Check aria-hidden size={26} />} title="Nothing unread" description="Every notification has been read." />
            ) : (
              <NoResults noun="notifications" onClear={list.clearAll} />
            )
          ) : (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                {pageRows.map((g) => {
                  const n = g.latest;
                  const sev = SEVERITY[n.severity];
                  const SevIcon = n.kind === "delivery_failed" ? Mail : sev.icon;
                  const repeats = g.items.length;
                  return (
                    <li key={g.key} className={cn("flex items-start gap-1 border-b border-border-soft pr-2 last:border-b-0 hover:bg-row-hover", g.unread && "bg-accent/[0.04]")}>
                      {/* The whole row opens the sheet; the device and rule in its
                          last line are links of their own (demo H). */}
                      <div
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 py-3.5 pl-4"
                        onClick={(e) => {
                          if (!(e.target as HTMLElement).closest("a, button")) openSheet(g);
                        }}
                      >
                        <button type="button" onClick={() => openSheet(g)} aria-haspopup="dialog" className="flex min-w-0 items-start gap-3 text-left">
                          <span title={sev.label} className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md", sev.className)}>
                            <SevIcon aria-hidden size={16} />
                            <span className="sr-only">{sev.label}</span>
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                            <span className="text-ink">
                              {g.unread && <span aria-label="Unread" className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle" />}
                              <strong className="font-medium">{n.message}</strong>
                              {repeats > 1 && (
                                <Tag size="sm" className="ml-2">
                                  ×{repeats}
                                </Tag>
                              )}
                            </span>
                            {n.detail && <span className="text-[13.5px] text-ink">{n.detail}</span>}
                          </span>
                          <ChevronRight aria-hidden size={15} className="mt-2 shrink-0 text-ink-muted" />
                        </button>
                        <span className="pl-[42px] text-[13px] text-ink-muted">
                          {sev.label}
                          <SourceLinks n={n} deviceName={deviceName} ruleName={ruleName} templateName={templateName} />
                          {" · "}
                          {repeats > 1 ? `since ${clock(g.first.created_at)}, last ${timeAgo(n.created_at)}` : timeAgo(n.created_at)}
                        </span>
                      </div>
                      <span className="pt-3">
                        <DropdownMenu
                          label={`Actions for ${n.message}`}
                          groups={[
                            [
                              g.unread
                                ? { label: "Mark as read", icon: <Check size={15} />, onClick: () => void readAll(g) }
                                : { label: "Mark as unread", icon: <Bell size={15} />, onClick: () => void unreadAll(g) },
                            ],
                            [{ label: "Dismiss", icon: <X size={15} />, danger: true, onClick: () => void onDismiss(g) }],
                          ]}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <TableFooter
                shown={groups.length}
                total={groups.length}
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
        onClose={() => setOpenKey(null)}
        title={open?.latest.message ?? "Notification"}
        sub={open ? `${SEVERITY[open.latest.severity].label}${open.items.length > 1 ? ` · ${open.items.length} times` : ""}` : undefined}
        footer={
          open ? (
            <>
              <Button variant="link-danger" className="mr-auto text-[13px]" onClick={() => void onDismiss(open)}>
                Dismiss
              </Button>
              <Button variant="ghost" onClick={() => void unreadAll(open)}>
                Mark as unread
              </Button>
              <Button onClick={() => setOpenKey(null)}>Done</Button>
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
              <dt className="text-ink-muted">{open.items.length > 1 ? "First" : "When"}</dt>
              <dd>{clock(open.first.created_at)}</dd>
              {open.items.length > 1 && (
                <>
                  <dt className="text-ink-muted">Last</dt>
                  <dd>
                    {clock(open.latest.created_at)} · {open.items.length} times
                  </dd>
                </>
              )}
            </dl>
            {open.items.length > 1 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium text-ink-muted">Each time</h3>
                <ol className="flex flex-col gap-1.5 border-l-2 border-border pl-3.5 text-[13px]">
                  {open.items.map((n) => (
                    <li key={n.id} className="tabular-nums text-ink">
                      {clock(n.created_at)}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </ItemSheet>
    </>
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
