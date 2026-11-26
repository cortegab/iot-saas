"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Eye, KeyRound, Lock, Plus } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { KeyPeek } from "@/components/keys/KeyPeek";
import { useRevokeKey } from "@/components/keys/useRevokeKey";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import { tActive as tr } from "@iodriven/shared/i18n";

/** API keys (DESIGN.md §6/§8): Key · Role · Last used · Expires · Status.
 * A row peeks; keys are created on /keys/new (the one-time secret) and are
 * read-only on /keys/{id} until revoked. */
export default function KeysPage() {
  const router = useRouter();
  const toast = useToast();
  const { endItems, dialog } = useRevokeKey();
  const { can } = usePermissions();
  const canManage = can("keys.manage");
  const { data: keys, error, isLoading, mutate } = useApiSWR<ApiKey[]>(canManage ? "/api-keys" : null);
  const list = useListState({ show: "active" }, { key: "created", dir: "desc" });

  const counts = useMemo(() => {
    const c = { active: 0, inactive: 0, all: keys?.length ?? 0 };
    for (const k of keys ?? []) c[keyStatus(k) === "active" ? "active" : "inactive"] += 1;
    return c;
  }, [keys]);

  const filtered = useMemo(() => {
    const show = list.filters.show;
    const rows = (keys ?? []).filter((k) => {
      const active = keyStatus(k) === "active";
      return (show === "all" || (show === "active" ? active : !active)) && matchesQuery(list.q, k.name, k.key_prefix, k.role);
    });
    return sortRows(rows, list.sort, (k, key) =>
      key === "used" ? (k.last_used_at ?? "") : key === "expires" ? (k.expires_at ?? "9999") : key === "name" ? k.name.toLowerCase() : k.created_at,
    );
  }, [keys, list.filters.show, list.q, list.sort]);
  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  const peek = usePeek({ rows: pageRows, rowKey: (k) => k.id, pageHref: (id) => `/keys/${id}`, newHref: "/keys/new" });

  const columns: DataColumn<ApiKey>[] = [
    {
      id: "name",
      header: tr("lists.keys.key"),
      sortable: true,
      cell: (k) => (
        <NameCell
          name={
            <Link href={`/keys/${k.id}`} className="hover:underline hover:underline-offset-[3px]">
              {k.name}
            </Link>
          }
          sub={
            <>
              Created {formatDate(k.created_at)} · <span className="font-mono">{k.key_prefix}…</span>
            </>
          }
        />
      ),
    },
    {
      id: "role",
      header: tr("lists.keys.scope"),
      cell: (k) => {
        const r = toRole(k.role);
        return <Tag tone="neutral">{r ? ROLE_LABEL[r] : k.role}</Tag>;
      },
    },
    { id: "used", header: tr("lists.keys.lastUsed"), sortable: true, hideOnPhone: true, priority: 3, fold: (k) => (k.last_used_at ? tr("lists.keys.usedAgo", { ago: timeAgo(k.last_used_at) }) : tr("lists.keys.neverUsed")), cell: (k) => <span className="text-ink-muted">{k.last_used_at ? timeAgo(k.last_used_at) : tr("lists.keys.never")}</span> },
    { id: "expires", header: tr("lists.keys.expires"), sortable: true, hideOnPhone: true, priority: 2, fold: (k) => (k.expires_at ? tr("lists.keys.expiresOn", { date: formatDate(k.expires_at) }) : null), cell: (k) => <span className="whitespace-nowrap text-ink-muted">{k.expires_at ? formatDate(k.expires_at) : tr("lists.keys.never")}</span> },
    {
      id: "status",
      header: tr("lists.keys.status"),
      cell: (k) => {
        const st = keyStatus(k);
        return <Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />;
      },
    },
  ];

  const rowMenu = (k: ApiKey): DropdownMenuItem[][] => [
    [
      { label: tr("lists.keys.open"), icon: <Eye size={15} />, onClick: () => router.push(`/keys/${k.id}`) },
      {
        label: tr("lists.keys.copyPrefix"),
        icon: <Copy size={15} />,
        onClick: () =>
          void navigator.clipboard
            .writeText(k.key_prefix)
            .then(() => toast({ tone: "info", title: tr("lists.keys.prefixCopied"), detail: tr("lists.keys.prefixDetail", { prefix: k.key_prefix }) }))
            .catch(() => toast({ tone: "error", title: tr("lists.keys.clipboard"), detail: k.key_prefix })),
      },
    ],
    ...endItems(k, () => peek.peekId === k.id && peek.close()),
  ];

  if (!canManage) {
    return (
      <>
        <PageHeader title={tr("lists.keys.title")} />
        <EmptyState icon={<Lock aria-hidden size={24} />} title={tr("lists.keys.adminsOnly")} description={tr("lists.keys.adminsOnlyBody")} />
      </>
    );
  }

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = keys?.length ?? 0;
  const newButton = (
    <Link href="/keys/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      {tr("lists.keys.new")}
    </Link>
  );

  return (
    <>
      {/* DESIGN.md §6: the primary action lives in the toolbar; the header
          holds it only while there's no toolbar (loading, error, first use). */}
      <PageHeader
        inline
        title={tr("lists.keys.title")}
        description={tr("lists.keys.description")}
        actions={!error && keys && total > 0 ? undefined : newButton}
      />
      {error ? (
        <ErrorState title={tr("lists.keys.loadFailed")} message={error instanceof ApiRequestError ? error.message : tr("devices.apiDown")} onRetry={() => void mutate()} />
      ) : isLoading || !keys ? (
        <TableSkeleton rows={3} columns={5} />
      ) : (
        <ListWithPeek
          label={tr("lists.keys.label")}
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? <KeyPeek apiKey={keys.find((k) => k.id === peek.peekId)} onClose={peek.close} />
              : null
          }
        >
          {total === 0 ? (
            <FirstUse
              icon={<KeyRound aria-hidden size={26} />}
              title={tr("lists.keys.emptyTitle")}
              description={tr("lists.keys.emptyBody")}
              action={newButton}
            />
          ) : (
            <>
              <ListToolbar
                query={list.q}
                onQuery={list.setQuery}
                placeholder={tr("lists.keys.search")}
                actions={newButton}
                quick={{
                  label: tr("lists.members.show"),
                  value: list.filters.show,
                  onChange: (v) => list.setFilter("show", v),
                  options: [
                    { value: "all", label: tr("devices.all"), count: counts.all },
                    { value: "active", label: tr("lists.keys.active"), count: counts.active, tone: "online", hint: tr("lists.keys.activeHint") },
                    { value: "inactive", label: tr("lists.keys.inactive"), count: counts.inactive, tone: "unknown", shape: "square", hint: tr("lists.keys.inactiveHint") },
                  ],
                }}
              />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun={tr("lists.keys.nounMany")} onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label={tr("lists.keys.title")}
                    columns={columns}
                    rows={pageRows}
                    rowKey={(k) => k.id}
                    sort={list.sort}
                    onSort={list.toggleSort}
                    onRowClick={peek.onRowClick}
                    onRowEnter={peek.onRowEnter}
                    rowMenu={rowMenu}
                    rowMenuLabel={(k) => `Actions for ${k.name}`}
                    currentKey={peek.peekId}
                    inactive={(k) => keyStatus(k) !== "active"}
                  />
                  <TableFooter
                    shown={filtered.length}
                    total={total}
                    noun={[tr("lists.keys.nounOne"), tr("lists.keys.nounMany")]}
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
        </ListWithPeek>
      )}
      {dialog}
    </>
  );
}
