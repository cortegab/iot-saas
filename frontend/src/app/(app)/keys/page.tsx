"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Copy, Eye, KeyRound, Lock, Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { useToast } from "@/components/ui/Toast";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { FirstUse, NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { SplitView } from "@/components/editor/SplitView";
import { KeyEditor } from "@/components/keys/KeyEditor";
import { ApiRequestError } from "@/lib/api-client";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];

/** API keys (DESIGN.md §6/§8): Key · Role · Last used · Expires · Status.
 * Created once with a one-time secret, then read-only until revoked. */
export default function KeysPage() {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { can } = usePermissions();
  const canManage = can("keys.manage");
  const { data: keys, error, isLoading, mutate } = useApiSWR<ApiKey[]>(canManage ? "/api-keys" : null);
  const list = useListState({ show: "active" }, { key: "created", dir: "desc" });
  const [secret, setSecret] = useState<ApiKeyCreateResponse | null>(null);

  const editId = params.get("edit");
  function setEditId(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("edit", id);
    else next.delete("edit");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

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

  async function revoke(k: ApiKey) {
    const ok = await confirm(
      <>
        Requests using <code className="font-mono">{k.key_prefix}…</code> fail from now on. Last used{" "}
        {k.last_used_at ? timeAgo(k.last_used_at) : "never"}.
      </>,
      { title: `Revoke ${k.name}?`, confirmLabel: "Revoke key" },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${k.id}`);
      await mutate();
      toast({ title: "Key revoked", detail: k.name });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't revoke the key", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const columns: DataColumn<ApiKey>[] = [
    { id: "name", header: "Key", sortable: true, cell: (k) => <NameCell name={k.name} sub={<span className="font-mono">{k.key_prefix}…</span>} /> },
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
      { label: "Open", icon: <Eye size={15} />, onClick: () => setEditId(k.id) },
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
    <Button onClick={() => setEditId("new")}>
      <Plus aria-hidden size={15} />
      New API key
    </Button>
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
          editorLabel={editId === "new" ? "New API key" : "API key"}
          onClose={() => setEditId(null)}
          editor={
            editId
              ? (mode) => (
                  <KeyEditor
                    key={editId}
                    keyId={editId === "new" ? null : editId}
                    mode={mode}
                    onClose={() => setEditId(null)}
                    onCreated={(result) => {
                      setSecret(result);
                      setEditId(result.api_key.id);
                    }}
                  />
                )
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
                    onRowClick={(k) => setEditId(k.id)}
                    rowMenu={rowMenu}
                    rowMenuLabel={(k) => `Actions for ${k.name}`}
                    currentKey={editId}
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
      <Dialog open={secret != null} onClose={() => undefined} title="Your new API key">
        {secret && (
          <SecretReveal
            fields={[{ label: "API key", value: secret.key, secret: true }]}
            title={
              <>
                Copy it now. We store only a hash, so <strong>{secret.api_key.name}</strong> can&apos;t be shown again.
              </>
            }
            requireAcknowledge
            onDismiss={() => setSecret(null)}
          />
        )}
      </Dialog>
      {dialog}
    </>
  );
}
