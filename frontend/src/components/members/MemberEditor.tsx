"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Lock, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/hooks/useAuth";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { FactList } from "@/components/ui/FactList";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { useMemberActions } from "./useMemberActions";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
import { formatWhen } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { NotFound } from "@/components/ui/NotFound";
import { tActive as tr } from "@iodriven/shared/i18n";

type MemberResponse = components["schemas"]["MemberResponse"];
type InvitationResponse = components["schemas"]["InvitationResponse"];

interface MemberDraft {
  email: string;
  role: Role;
}

/** The invite's role hint (demo H wording). */
const INVITE_HINT: Record<Role, string> = {
  get owner() { return tr("mem.hintOwner"); },
  get admin() { return tr("mem.hintAdmin"); },
  get viewer() { return tr("mem.hintViewer"); },
};

export const ROLE_HELP: Record<Role, string> = {
  get owner() { return tr("mem.hintOwner"); },
  get admin() { return tr("mem.helpAdmin"); },
  get viewer() { return tr("mem.helpViewer"); },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Role[] = ["viewer", "admin", "owner"];

/** Invite someone (memberId null, /members/invite) or change a member's role
 * (/members/{id}) — DESIGN.md §8; the list only peeks. Only an owner grants
 * or removes Owner; the backend enforces the same and refuses to demote or
 * remove the last owner. */
export function MemberEditor({ memberId, mode = "page" }: { memberId: string | null; mode?: EditorMode }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const { role: myRole, can } = usePermissions();
  const { data: me } = useCurrentUser();
  const { confirm, dialog } = useConfirm();
  const { data: members, error, mutate } = useApiSWR<MemberResponse[]>("/tenants/members");
  const { data: invites } = useApiSWR<InvitationResponse[]>(can("members.manage") ? "/tenants/invitations" : null);

  const isNew = memberId == null;
  const member = members?.find((m) => m.user_id === memberId);
  const isMe = member != null && member.user_id === me?.id;
  const iAmOwner = myRole === "owner";
  const readOnly = !can("members.manage") || (member?.role === "owner" && !iAmOwner);

  const source = useMemo<MemberDraft | null>(() => {
    if (isNew) return { email: "", role: "viewer" };
    return member ? { email: member.email, role: member.role as Role } : null;
  }, [isNew, member]);

  const taken = useMemo(
    () => new Set([...(members ?? []).map((m) => m.email.toLowerCase()), ...(invites ?? []).map((i) => i.email.toLowerCase())]),
    [members, invites],
  );
  const validate = useCallback(
    (d: MemberDraft): Validation => {
      const errors: Record<string, string> = {};
      const warnings: Record<string, string> = {};
      if (isNew) {
        const email = d.email.trim().toLowerCase();
        if (!EMAIL.test(email)) errors["member.email"] = tr("mem.enterEmail");
        else if (taken.has(email)) errors["member.email"] = tr("mem.taken");
      }
      if (d.role === "owner" && !iAmOwner && member?.role !== "owner") errors["member.role"] = tr("mem.ownerOnly");
      if (isMe && member && d.role !== member.role) warnings["member.role"] = tr("mem.selfWarn");
      return { errors, warnings };
    },
    [isNew, taken, iAmOwner, member, isMe],
  );
  const editor = useRecordEditor({ source, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, member?.email ?? "this invite");
  const { removeMember, dialog: actionDialog } = useMemberActions(() => router.push("/members"));

  async function onSave(): Promise<boolean> {
    const d = editor.draft;
    if (!d) return false;
    if (isMe && member && d.role !== member.role) {
      const ok = await confirm(
        tr(d.role === "viewer" ? "mem.selfBodyAdmin" : "mem.selfBodyOwner", { from: ROLE_LABEL[member.role as Role], to: ROLE_LABEL[d.role] }),
        { title: tr("mem.selfTitle"), confirmLabel: tr("mem.become", { role: ROLE_LABEL[d.role] }) },
      );
      if (!ok) return false;
    }
    return editor
      .save(async (v) => {
        try {
          if (isNew) {
            const email = v.email.trim().toLowerCase();
            const sent = await api.post<InvitationResponse>("/tenants/invitations", { email, role: v.role });
            await revalidate("/tenants/invitations");
            toast({ title: tr("mem.inviteSent"), detail: tr("mem.inviteSentDetail", { email }) });
            // An invite has no page of its own: back to the list, showing it.
            router.push(`/members?peek=invite.${sent.id}`);
          } else {
            await api.patch(`/tenants/members/${memberId}`, { role: v.role });
            await mutate();
            if (isMe) await refresh();
            toast({ title: tr("mem.nowRole", { name: member?.name || member?.email || "", role: ROLE_LABEL[v.role] }) });
          }
        } catch (err) {
          toast({ tone: "error", title: tr("mem.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState title={tr("mem.loadFailed")} message={error instanceof ApiRequestError ? error.message : tr("mem.noResponse")} onRetry={() => void mutate()} />
      </div>
    );
  }
  // The list has loaded and the member isn't in it: gone, not still loading.
  if (!isNew && members && !member) return <NotFound noun="member" href="/members" list="members" description={tr("mem.gone")} />;
  const d = editor.draft;
  if (!d || (!isNew && !member)) {
    return (
      <div className="p-5">
        <LoadingSkeleton rows={3} rowClassName="h-10" />
      </div>
    );
  }

  const roleError = editor.errorFor("member.role");
  const roleWarning = editor.warningFor("member.role");
  return (
    <>
      <EditorFrame
        mode={mode}
        noun={isNew ? "invite" : "member"}
        title={isNew ? tr("mem.inviteTitle") : member!.name || member!.email}
        eyebrow={
          isNew ? (
            undefined
          ) : (
            <>
              {member!.joined_at && <span>{tr("mem.joined", { when: formatWhen(member!.joined_at) })}</span>}
              {isMe && <span>{member!.joined_at ? tr("mem.youSuffix") : tr("mem.you")}</span>}
            </>
          )
        }
        consequence={isNew ? tr("mem.consNew") : tr("mem.consEdit")}
        sections={[{ id: "member", label: tr("mem.member") }]}
        status={editor}
        readOnly={readOnly}
        saveLabel={isNew ? tr("mem.sendInvite") : tr("mem.saveRole")}
        onSave={onSave}
        onDiscard={editor.discard}
        menu={
          !isNew && !readOnly && !isMe
            ? [[{ label: tr("mem.remove"), icon: <Trash2 size={15} />, danger: true, onClick: () => void removeMember(member!) }]]
            : undefined
        }
      >
        {isNew ? (
          // demo H Invite: Email and Role side by side, the role as a segmented control.
          <EditorSection id="member" title={tr("mem.who")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={tr("mem.email")} error={editor.errorFor("member.email")}>
                <Input
                  type="email"
                  autoFocus
                  value={d.email}
                  placeholder="name@example.com"
                  onChange={(e) => editor.set({ ...d, email: e.target.value })}
                  onBlur={() => editor.touch("member.email")}
                />
              </Field>
              <div className="flex flex-col gap-[5px]">
                <span className="text-meta font-medium text-ink">{tr("mem.role")}</span>
                <SegmentedControl
                  ariaLabel={tr("mem.role")}
                  size="md"
                  value={d.role}
                  onChange={(role) => {
                    editor.set({ ...d, role });
                    editor.touch("member.role");
                  }}
                  options={ROLES.filter((r) => r !== "owner" || iAmOwner).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                />
                <span className={cn("text-xs", roleError ? "text-status-error" : "text-ink-muted")}>{roleError ?? INVITE_HINT[d.role]}</span>
              </div>
            </div>
          </EditorSection>
        ) : (
        <EditorSection id="member" title={tr("mem.member")}>
          {isNew ? (
            <Field label={tr("mem.email")} error={editor.errorFor("member.email")} hint={tr("mem.emailHint")}>
              <Input
                type="email"
                autoFocus
                value={d.email}
                placeholder="name@example.com"
                onChange={(e) => editor.set({ ...d, email: e.target.value })}
                onBlur={() => editor.touch("member.email")}
              />
            </Field>
          ) : (
            <FactList facts={[[tr("mem.email"), <span key="email" className="font-mono">{member!.email}</span>]]} />
          )}
          <fieldset className="flex flex-col gap-2" aria-describedby="member-role-msg">
            <legend className="mb-1.5 text-meta font-medium text-ink">{tr("mem.role")}</legend>
            {ROLES.map((r) => {
              const locked = r === "owner" && !iAmOwner && member?.role !== "owner";
              const on = d.role === r;
              return (
                <label
                  key={r}
                  className={cn(
                    "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 rounded-md border border-border bg-canvas px-3.5 py-3 hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]",
                    on && "border-accent bg-accent-muted",
                    (locked || readOnly) && "cursor-not-allowed opacity-60 hover:border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="member-role"
                    value={r}
                    checked={on}
                    disabled={locked || readOnly}
                    onChange={() => {
                      editor.set({ ...d, role: r });
                      editor.touch("member.role");
                    }}
                    className="mt-[3px] accent-[var(--color-accent)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <strong className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      {ROLE_LABEL[r]}
                      {locked && <Lock aria-hidden size={13} className="text-ink-muted" />}
                    </strong>
                    <small className="text-xs text-ink-muted">
                      {ROLE_HELP[r]}
                      {locked && tr("mem.ownerGrant")}
                    </small>
                  </span>
                </label>
              );
            })}
            <p
              id="member-role-msg"
              className={cn("min-h-[18px] text-xs", roleError ? "text-status-error" : "text-status-pending")}
            >
              {roleError ?? roleWarning ?? ""}
            </p>
          </fieldset>
        </EditorSection>
        )}
      </EditorFrame>
      {dialog}
      {actionDialog}
      {guardDialog}
    </>
  );
}
