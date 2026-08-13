"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type MemberResponse = components["schemas"]["MemberResponse"];
type TenantRole = "owner" | "admin" | "viewer";

const ROLE_OPTIONS: TenantRole[] = ["viewer", "admin", "owner"];

// This backend has three fixed roles (tenants/models.py's TenantRole) rather
// than a granular permission matrix — so "Roles & Permissions" documents what
// each rank can do and hosts the assignment control, not a permissions builder.
const ROLE_DESCRIPTIONS: { role: TenantRole; description: string }[] = [
  { role: "owner", description: "Full control, including renaming the organization and managing billing-equivalent settings. Exactly the creator by default; can be reassigned." },
  { role: "admin", description: "Can manage devices, device templates, rules, and members, but cannot rename the organization." },
  { role: "viewer", description: "Read-only access to devices, telemetry, rules, and notifications. Cannot create, edit, or delete anything." },
];

function RoleAssignmentRow({ member, onChanged }: { member: MemberResponse; onChanged: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(role: TenantRole) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/tenants/members/${member.user_id}`, { role });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't change this member's role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card padding="sm" className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">{member.email}</span>
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) => void changeRole(e.target.value as TenantRole)}
            className="rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-ink disabled:opacity-60"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {error && <ErrorState message={error} />}
      </Card>
    </li>
  );
}

export default function RolesSettingsPage() {
  const isAdmin = useIsAdmin();
  const { data: members, error, isLoading, mutate } = useApiSWR<MemberResponse[]>("/tenants/members");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-ink">Roles & Permissions</h1>

      <ul className="flex flex-col gap-2">
        {ROLE_DESCRIPTIONS.map((r) => (
          <li key={r.role}>
            <Card padding="sm">
              <p className="text-sm font-medium capitalize text-ink">{r.role}</p>
              <p className="text-sm text-ink-muted">{r.description}</p>
            </Card>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">Assign roles</h2>

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
                <RoleAssignmentRow key={m.user_id} member={m} onChanged={() => void mutate()} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
