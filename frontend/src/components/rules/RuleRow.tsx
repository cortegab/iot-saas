"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { ErrorState } from "@/components/ui/ErrorState";
import { ApiRequestError } from "@/lib/api-client";
import { RuleSummary } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

export function RuleRow({
  rule,
  isAdmin,
  deviceLink,
  onEdit,
  onChanged,
}: {
  rule: RuleResponse;
  isAdmin: boolean;
  /** Set on the tenant-wide /rules list to say which device this rule
   * belongs to — omitted on a device's own page, where that's implied. */
  deviceLink?: { href: string; label: string };
  onEdit: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleEnabled() {
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/rules/${rule.id}`, { enabled: !rule.enabled });
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't update this rule.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this rule? This cannot be undone.")) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/rules/${rule.id}`);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete this rule.");
      setBusy(false);
    }
  }

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border-l-4 border-y border-r border-border bg-surface p-4 ${
        rule.enabled ? "border-l-status-online" : "border-l-status-unknown opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <RuleSummary rule={rule} />
        <div className="flex shrink-0 items-center gap-2">
          {deviceLink && (
            <Link
              href={deviceLink.href}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              {deviceLink.label}
            </Link>
          )}
          {!rule.enabled && (
            <span className="rounded-full bg-status-unknown/10 px-2 py-0.5 text-xs font-medium text-ink-muted">
              Disabled
            </span>
          )}
        </div>
      </div>

      {actionError && <ErrorState message={actionError} />}

      {isAdmin && (
        <div className="flex gap-3 text-sm">
          <button type="button" onClick={onEdit} className="text-accent">
            Edit
          </button>
          <button type="button" disabled={busy} onClick={() => void toggleEnabled()} className="text-ink-muted hover:text-ink disabled:opacity-60">
            {rule.enabled ? "Disable" : "Enable"}
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className="text-status-error disabled:opacity-60">
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
