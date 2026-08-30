"use client";

import { useState, type FormEvent } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type MemberResponse = components["schemas"]["MemberResponse"];
type TenantRole = "owner" | "admin" | "viewer";

const ROLE_OPTIONS: TenantRole[] = ["viewer", "admin", "owner"];

function InviteMemberForm({ onInvited }: { onInvited: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/tenants/members", { email: email.trim(), role });
      setEmail("");
      setRole("viewer");
      onInvited();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't add this member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Email
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Role
        <Select value={role} onChange={(e) => setRole(e.target.value as TenantRole)}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="md" disabled={submitting}>
        {submitting ? "Inviting…" : "Invite"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-status-error">
          {error}
        </p>
      )}
    </form>
  );
}

function MemberRow({ member, isAdmin, onChanged }: { member: MemberResponse; isAdmin: boolean; onChanged: () => void }) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!(await confirm(`Remove ${member.email} from this workspace?`))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/tenants/members/${member.user_id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't remove this member.");
      setBusy(false);
    }
  }

  return (
    <li>
      <Card padding="sm" className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">{member.email}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-ink-muted">{member.role}</span>
            {isAdmin && (
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        </div>
        {error && <ErrorState message={error} />}
      </Card>
      {dialog}
    </li>
  );
}

export default function UsersSettingsPage() {
  const isAdmin = useIsAdmin();
  const { data: members, error, isLoading, mutate } = useApiSWR<MemberResponse[]>("/tenants/members");

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && <InviteMemberForm onInvited={() => void mutate()} />}

      {isLoading && <LoadingSkeleton rows={2} rowClassName="h-14" />}

      {error && (
        <ErrorState
          message={error instanceof ApiRequestError ? error.message : "Couldn't load members."}
          onRetry={() => void mutate()}
        />
      )}

      {!isLoading && (!members || members.length === 0) && (
        <EmptyState title="No members yet" description="This workspace has no members." />
      )}

      {members && members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <MemberRow key={m.user_id} member={m} isAdmin={isAdmin} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}
