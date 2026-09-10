"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Section } from "@/components/ui/Section";
import { Textarea } from "@/components/ui/Textarea";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type TenantResponse = components["schemas"]["TenantResponse"];

/** Recipients for rule notification "Email" alerts. Empty ⇒ the backend
 * falls back to every owner/admin member's email. Owner-gated
 * (PATCH /tenants/current is require_role(OWNER)). */
export default function AlertsSettingsPage() {
  const api = useApi();
  const { memberships, currentTenantId } = useAuth();
  const isOwner = memberships.find((m) => m.tenant_id === currentTenantId)?.role === "owner";
  const { data, error, isLoading, mutate } = useApiSWR<TenantResponse>("/tenants/current");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (isLoading) return <LoadingSkeleton rows={1} rowClassName="h-24" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load alert settings."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!data) return null;

  const recipients = data.notification_emails;

  async function save() {
    setBusy(true);
    setSaveError(null);
    const emails = text
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    try {
      await api.patch("/tenants/current", { notification_emails: emails });
      setEditing(false);
      void mutate();
    } catch (err) {
      setSaveError(
        err instanceof ApiRequestError ? err.message : "Couldn't save the recipient list.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Email recipients">
        <Card>
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                compact
                autoFocus
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="ops@acme.com, on-call@acme.com"
              />
              <p className="text-xs text-ink-muted">
                One address per line (or comma-separated). Leave empty to send to all
                owners and admins.
              </p>
              <div className="flex gap-2">
                <Button type="button" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                {recipients.length > 0 ? (
                  <ul className="flex flex-col gap-0.5 text-ink">
                    {recipients.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted">
                    Not set — alerts go to every owner and admin.
                  </p>
                )}
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setText(recipients.join("\n"));
                    setEditing(true);
                  }}
                  className="shrink-0 text-sm text-ink-muted hover:text-ink"
                >
                  Edit
                </button>
              )}
            </div>
          )}
          {saveError && <ErrorState message={saveError} />}
        </Card>
      </Section>
    </div>
  );
}
