"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Copy, Eye, KeyRound, Lock, Plus } from "lucide-react";
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
import { SplitView } from "@/components/editor/SplitView";
import { KeyPeek } from "@/components/keys/KeyPeek";
import { useRevokeKey } from "@/components/keys/useRevokeKey";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";

/** API keys (DESIGN.md §6/§8): Key · Role · Last used · Expires · Status.
 * A row peeks; keys are created on /keys/new (the one-time secret) and are
 * read-only on /keys/{id} until revoked. */
export default function KeysPage() {
  const router = useRouter();
  const toast = useToast();
  const { revoke, dialog } = useRevokeKey();
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
      header: "Key",
      sortable: true,
      cell: (k) => (
        <NameCell
          name={
            <Link href={`/keys/${k.id}`} className="hover:underline hover:underline-offset-[3px]">
              {k.name}
            </Link>
          }
          sub={<span className="font-mono">{k.key_prefix}…</span>}
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (k) => {
        const r = toRole(k.role);
        return <Tag tone="neutral">{r ? ROLE_LABEL[r] : k.role}</Tag>;
      },
    },
    { id: "used", header: "Last used", sortable: true, hideOnPhone: true, cell: (k) => <span className="text-ink-muted">{k.last_used_at ? timeAgo(k.last_used_at) : "Never"}</span> },
    { id: "expires", header: "Expires", sortable: true, hideOnPhone: true, cell: (k) => <span className="whitespace-nowrap text-ink-muted">{k.expires_at ? formatDate(k.expires_at) : "Never"}</span> },
    {
      id: "status",
      header: "Status",
      cell: (k) => {
        const st = keyStatus(k);
        return <Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />;
      },
    },
  ];

  const rowMenu = (k: ApiKey): DropdownMenuItem[][] => [
    [
      { label: "Open", icon: <Eye size={15} />, onClick: () => router.push(`/keys/${k.id}`) },
      {
        label: "Copy prefix",
        icon: <Copy size={15} />,
        onClick: () =>
          void navigator.clipboard
            .writeText(k.key_prefix)
            .then(() => toast({ tone: "info", title: "Prefix copied", detail: `${k.key_prefix}… identifies the key in logs.` }))
            .catch(() => toast({ tone: "error", title: "Couldn't reach the clipboard", detail: k.key_prefix })),
      },
    ],
    ...(keyStatus(k) === "active" ? [[{ label: "Revoke…", icon: <Ban size={15} />, danger: true, onClick: () => void revoke(k) }]] : []),
  ];

  if (!canManage) {
    return (
      <>
        <PageHeader title="API keys" />
        <EmptyState icon={<Lock aria-hidden size={24} />} title="Admins manage API keys" description="Ask an admin if an integration needs access." />
      </>
    );
  }

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const total = keys?.length ?? 0;
  const newButton = (
    <Link href="/keys/new" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      New API key
    </Link>
  );

  return (
    <>
      <PageHeader title="API keys" description="For scripts and integrations. Each key has a role and is shown once when created." actions={newButton} />
      {error ? (
        <ErrorState title="Couldn't load API keys" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      ) : isLoading || !keys ? (
        <TableSkeleton rows={3} columns={5} />
      ) : (
        <SplitView
          editorLabel="API key"
          onClose={peek.close}
          editor={
            peek.peekId
              ? (mode) => <KeyPeek key={peek.peekId} apiKey={keys.find((k) => k.id === peek.peekId)} mode={mode} onClose={peek.close} />
              : null
          }
        >
          {total === 0 ? (
            <FirstUse
              icon={<KeyRound aria-hidden size={26} />}
              title="No API keys yet"
              description="Create a key for a script or integration — Grafana, an ERP sync, a CI job. It authenticates as Authorization: Bearer with the role you pick."
              action={newButton}
            />
          ) : (
            <>
              <ListToolbar
                query={list.q}
                onQuery={list.setQuery}
                placeholder="Search keys"
                quick={{
                  label: "Show",
                  value: list.filters.show,
                  onChange: (v) => list.setFilter("show", v),
                  options: [
                    { value: "active", label: "Active", count: counts.active },
                    { value: "inactive", label: "Revoked or expired", count: counts.inactive },
                    { value: "all", label: "All", count: counts.all },
                  ],
                }}
              />
              <FilterChips chips={chips} onClearAll={list.clearAll} />
              {filtered.length === 0 ? (
                <NoResults noun="keys" onClear={list.clearAll} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable
                    label="API keys"
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
                    rowClassName={(k) => (keyStatus(k) === "active" ? undefined : "opacity-60")}
                  />
                  <TableFooter
                    shown={filtered.length}
                    total={total}
                    noun={["key", "keys"]}
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
        </SplitView>
      )}
      {dialog}
    </>
  );
}
