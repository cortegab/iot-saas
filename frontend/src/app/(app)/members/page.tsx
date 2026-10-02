"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Send, Trash2, Users } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, NameCell, type DataColumn } from "@/components/list/DataTable";
import { FilterChips, ListToolbar, type FilterChip } from "@/components/list/ListToolbar";
import { NoResults } from "@/components/list/ListStates";
import { TableFooter } from "@/components/list/TableFooter";
import { matchesQuery, paginate, sortRows, useListState } from "@/components/list/useListState";
import { ListWithPeek } from "@/components/list/ListWithPeek";
import { MemberPeek } from "@/components/members/MemberPeek";
import { useMemberActions } from "@/components/members/useMemberActions";
import { usePeek } from "@/components/list/usePeek";
import { ApiRequestError } from "@/lib/api-client";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type MemberResponse = components["schemas"]["MemberResponse"];
type InvitationResponse = components["schemas"]["InvitationResponse"];

type Row =
  | { kind: "member"; id: string; name: string; email: string; role: string; joined: string | null; you: boolean; member: MemberResponse }
  | { kind: "invite"; id: string; name: string; email: string; role: string; joined: null; you: false; invite: InvitationResponse };

const roleLabel = (r: string) => {
  const role = toRole(r);
  return role ? ROLE_LABEL[role] : r;
};

/** Members (DESIGN.md §6/§8): Member · Role · Joined, invites listed with the
 * members they'll become. A row peeks; roles change on /members/{id}, and
 * invites are sent from /members/invite. Owner is granted and removed by
 * owners only. */
export default function MembersPage() {
  const router = useRouter();
  const { role: myRole, can } = usePermissions();
  const canManage = can("members.manage");
  const { data: me } = useCurrentUser();
  const { data: members, error, isLoading, mutate } = useApiSWR<MemberResponse[]>("/tenants/members");
  const { data: invites } = useApiSWR<InvitationResponse[]>(canManage ? "/tenants/invitations" : null);
  const list = useListState({ show: "all" }, { key: "name", dir: "asc" });

  const rows = useMemo<Row[]>(
    () => [
      ...(members ?? []).map<Row>((m) => ({
        kind: "member",
        id: m.user_id,
        name: m.name || m.email,
        email: m.email,
        role: m.role,
        joined: m.joined_at ?? null,
        you: m.user_id === me?.id,
        member: m,
      })),
      ...(invites ?? []).map<Row>((i) => ({ kind: "invite", id: `invite.${i.id}`, name: i.email, email: i.email, role: i.role, joined: null, you: false, invite: i })),
    ],
    [members, invites, me?.id],
  );
  const counts = { all: rows.length, active: members?.length ?? 0, invited: invites?.length ?? 0 };

  const filtered = useMemo(() => {
    const show = list.filters.show;
    const r = rows.filter(
      (x) => (show === "all" || (show === "invited" ? x.kind === "invite" : x.kind === "member")) && matchesQuery(list.q, x.name, x.email, x.role),
    );
    return sortRows(r, list.sort, (x, key) => (key === "role" ? x.role : key === "joined" ? (x.joined ?? "") : x.name.toLowerCase()));
  }, [rows, list.filters.show, list.q, list.sort]);
  const { pageRows, pageCount, page } = paginate(filtered, list.page, list.pageSize);

  const peek = usePeek({ rows: pageRows, rowKey: (x) => x.id, pageHref: (id) => (id.startsWith("invite.") ? `/members?peek=${id}` : `/members/${id}`), newHref: "/members/invite" });
  const { removeMember, resend, cancelInvite, dialog } = useMemberActions((id) => {
    if (peek.peekId === id) peek.close();
  });

  const columns: DataColumn<Row>[] = [
    {
      id: "name",
      header: "Member",
      sortable: true,
      cell: (x) => (
        <NameCell
          name={
            <>
              {x.kind === "member" ? (
                <Link href={`/members/${x.id}`} className="hover:underline hover:underline-offset-[3px]">
                  {x.name}
                </Link>
              ) : (
                x.name
              )}
              {x.you && <span className="font-normal text-ink-muted"> (you)</span>}
            </>
          }
          sub={x.kind === "invite" ? `Invite sent ${timeAgo(x.invite.created_at)}` : x.name !== x.email ? x.email : undefined}
        />
      ),
    },
    {
      id: "role",
      header: "Role",
      sortable: true,
      cell: (x) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Tag tone={x.role === "owner" ? "accent" : "neutral"}>{roleLabel(x.role)}</Tag>
          {x.kind === "invite" && <Badge tone="pending" shape="hollow" label="Invited" />}
        </span>
      ),
    },
    {
      id: "joined",
      header: "Joined",
      sortable: true,
      hideOnPhone: true,
      cell: (x) =>
        x.kind === "invite" ? (
          <span className="text-ink-muted">Expires {formatDate(x.invite.expires_at)}</span>
        ) : (
          <span className="text-ink-muted">{x.joined ? formatDate(x.joined) : "—"}</span>
        ),
    },
  ];

  const rowMenu = (x: Row): DropdownMenuItem[][] => {
    if (!canManage) return [];
    // Leaving the workspace lives in Workspace settings, not here.
    if (x.you) return [[{ label: "Change your role", icon: <Users size={15} />, onClick: () => router.push(`/members/${x.id}`) }]];
    if (x.kind === "invite") {
      return [
        [{ label: "Resend invite", icon: <Send size={15} />, onClick: () => void resend(x.invite) }],
        [{ label: "Cancel invite…", icon: <Trash2 size={15} />, danger: true, onClick: () => void cancelInvite(x.invite) }],
      ];
    }
    const ownerLocked = x.role === "owner" && myRole !== "owner";
    return [
      [{ label: "Change role", icon: <Users size={15} />, onClick: () => router.push(`/members/${x.id}`) }],
      ...(ownerLocked ? [] : [[{ label: "Remove from workspace…", icon: <Trash2 size={15} />, danger: true, onClick: () => void removeMember(x.member) }]]),
    ];
  };

  const chips: FilterChip[] = list.q ? [{ id: "q", label: `Search: “${list.q}”`, onRemove: () => list.setQuery("") }] : [];
  const inviteButton = canManage ? (
    <Link href="/members/invite" className={buttonClassName()}>
      <Plus aria-hidden size={15} />
      Invite member
    </Link>
  ) : null;
  const peeked = peek.peekId ? rows.find((x) => x.id === peek.peekId) : undefined;

  return (
    <>
      <PageHeader
        title="Members"
        description="People with access to this workspace. Only an owner can grant or remove the Owner role."
        actions={inviteButton}
      />
      {error ? (
        <ErrorState title="Couldn't load members" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      ) : isLoading || !members ? (
        <TableSkeleton rows={4} columns={3} />
      ) : (
        <ListWithPeek
          label="Member"
          onClose={peek.close}
          nav={peek.nav}
          peek={
            peek.peekId
              ? (
                  <MemberPeek
                    member={peeked?.kind === "member" ? peeked.member : undefined}
                    invite={peeked?.kind === "invite" ? peeked.invite : undefined}
                    isMe={peeked?.you ?? false}
                    onClose={peek.close}
                  />
                )
              : null
          }
        >
          <ListToolbar
            query={list.q}
            onQuery={list.setQuery}
            placeholder="Search members"
            quick={
              canManage
                ? {
                    label: "Show",
                    value: list.filters.show,
                    onChange: (v) => list.setFilter("show", v),
                    options: [
                      { value: "all", label: "All", count: counts.all },
                      { value: "active", label: "Active", count: counts.active },
                      { value: "invited", label: "Invited", count: counts.invited },
                    ],
                  }
                : undefined
            }
          />
          <FilterChips chips={chips} onClearAll={list.clearAll} />
          {filtered.length === 0 ? (
            <NoResults noun="members" onClear={list.clearAll} />
          ) : (
            <div className="flex flex-col gap-2">
              <DataTable
                label="Members"
                columns={columns}
                rows={pageRows}
                rowKey={(x) => x.id}
                sort={list.sort}
                onSort={list.toggleSort}
                onRowClick={peek.onRowClick}
                onRowEnter={peek.onRowEnter}
                rowMenu={rowMenu}
                rowMenuLabel={(x) => `Actions for ${x.name}`}
                currentKey={peek.peekId}
              />
              <TableFooter
                shown={filtered.length}
                total={rows.length}
                noun={["member", "members"]}
                page={page}
                pageCount={pageCount}
                pageSize={list.pageSize}
                onPage={list.setPage}
                onPageSize={list.setPageSize}
              />
            </div>
          )}
        </ListWithPeek>
      )}
      {dialog}
    </>
  );
}
