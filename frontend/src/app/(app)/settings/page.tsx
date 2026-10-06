"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { LogOut, Mail, Plus, X } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { CopyField } from "@/components/ui/SecretReveal";
import { TimezoneSelect } from "@/components/ui/TimezoneSelect";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";

type UserResponse = components["schemas"]["UserResponse"];

interface SettingsDraft {
  name: string;
  recipients: string[];
  timezone: string;
  myName: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DIFF: DiffField<SettingsDraft>[] = [
  { label: "Workspace name", get: (d) => d.name.trim() },
  { label: "Alert recipients", get: (d) => d.recipients.join(", ") || "none" },
  { label: "Time zone", get: (d) => d.timezone },
  { label: "Your name", get: (d) => d.myName.trim() },
];

/** Workspace settings (DESIGN.md §8) as one record on the editor chrome:
 * name (owners), alert recipients and time zone (admins), your own name,
 * and leaving the workspace. */
export default function WorkspaceSettingsPage() {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const { role, can } = usePermissions();
  const { confirm, dialog } = useConfirm();
  const { data: ws, error, mutate } = useWorkspace();
  const { data: me, mutate: mutateMe } = useApiSWR<UserResponse>("/auth/me");
  const canRename = can("workspace.rename");
  const canEdit = can("workspace.alerts");
  const [recipient, setRecipient] = useState("");
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const source = useMemo<SettingsDraft | null>(
    () =>
      ws && me
        ? { name: ws.name, recipients: [...ws.notification_emails], timezone: ws.timezone, myName: me.name ?? "" }
        : null,
    [ws, me],
  );
  const validate = useCallback((d: SettingsDraft): Validation => {
    const errors: Record<string, string> = {};
    if (!d.name.trim()) errors["ws.name"] = "Give the workspace a name.";
    else if (d.name.trim().length > 100) errors["ws.name"] = "Keep the name under 100 characters.";
    if (d.myName.length > 100) errors["me.name"] = "Keep your name under 100 characters.";
    return { errors };
  }, []);
  const editor = useRecordEditor({ source, isNew: false, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, "workspace settings");

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor
      .save(async (d) => {
        try {
          if (before && (d.name !== before.name || d.timezone !== before.timezone || d.recipients.join() !== before.recipients.join())) {
            await api.patch("/tenants/current", {
              ...(canRename && d.name.trim() !== before.name ? { name: d.name.trim() } : {}),
              ...(canEdit ? { notification_emails: d.recipients, timezone: d.timezone } : {}),
            });
            await mutate();
            // The workspace name shows in the switcher (memberships).
            if (d.name.trim() !== before.name) await refresh();
          }
          if (before && d.myName.trim() !== before.myName.trim()) {
            await api.patch("/auth/me", { name: d.myName.trim() || null });
            await mutateMe();
          }
          toast({ title: "Settings saved", detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function leave() {
    if (!ws) return;
    const ok = await confirm("You lose access immediately and your personal dashboards here are deleted. An admin has to invite you again.", {
      title: `Leave ${ws.name}?`,
      confirmLabel: "Leave workspace",
    });
    if (!ok) return;
    try {
      await api.post("/tenants/leave");
      await revalidate(() => true, undefined, { revalidate: false });
      await refresh();
      toast({ title: `You left ${ws.name}` });
      router.replace("/devices");
    } catch (err) {
      toast({
        tone: "error",
        title: "Couldn't leave the workspace",
        detail: err instanceof ApiRequestError ? err.message : undefined,
      });
    }
  }

  if (error) {
    return (
      <ErrorState title="Couldn't load workspace settings" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
    );
  }
  const d = editor.draft;
  if (!d || !ws) return <LoadingSkeleton rows={5} rowClassName="h-14" />;

  function addRecipient() {
    if (!d) return;
    const v = recipient.trim().toLowerCase();
    if (!EMAIL.test(v)) return setRecipientError("Enter an email address.");
    if (d.recipients.includes(v)) return setRecipientError("Already on the list.");
    if (d.recipients.length >= 50) return setRecipientError("Up to 50 recipients.");
    editor.set({ ...d, recipients: [...d.recipients, v] });
    setRecipient("");
    setRecipientError(null);
  }

  return (
    <>
      <EditorFrame
        mode="page"
        noun="settings"
        title="Workspace settings"
        consequence={`Applies to everyone in ${ws.name}.`}
        sections={[
          { id: "workspace", label: "Workspace" },
          { id: "alerts", label: "Alert recipients", count: d.recipients.length },
          { id: "time", label: "Time" },
          { id: "account", label: "Your account" },
          { id: "leave", label: "Leave" },
        ]}
        sectionOf={(p) => (p.startsWith("me.") ? "account" : "workspace")}
        status={editor}
        saveLabel="Save settings"
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <EditorSection id="workspace" title="Workspace" lead="Only an owner can rename the workspace.">
          <div className="grid gap-3.5 @xl:grid-cols-2">
            <Field
              label="Name"
              error={editor.errorFor("ws.name")}
              hint={canRename ? undefined : "Ask an owner to change it."}
            >
              <Input
                value={d.name}
                disabled={!canRename}
                onChange={(e) => editor.set({ ...d, name: e.target.value })}
                onBlur={() => editor.touch("ws.name")}
              />
            </Field>
            <Field label="Topic prefix" hint="Fixed. Every device's MQTT topics start with it.">
              <CopyField value={`${ws.slug}/`} label="topic prefix" />
            </Field>
          </div>
        </EditorSection>

        <EditorSection
          id="alerts"
          title="Alert recipients"
          lead="Rules with an email action send here unless they list their own recipients. With nobody listed, alerts go to every owner and admin."
        >
          <ul className="flex flex-wrap gap-1.5" aria-label="Alert recipients">
            {d.recipients.length === 0 && <li className="text-sm text-ink-muted">Nobody listed: owners and admins get the alerts.</li>}
            {d.recipients.map((r) => (
              <li
                key={r}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-2.5 pr-1 text-[13px] text-ink"
              >
                <Mail aria-hidden size={12} className="text-ink-muted" />
                {r}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remove ${r}`}
                    onClick={() => editor.set({ ...d, recipients: d.recipients.filter((x) => x !== r) })}
                    className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-ink"
                  >
                    <X aria-hidden size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <Field label="Add recipient" error={recipientError}>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={recipient}
                  placeholder="name@example.com"
                  autoComplete="off"
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setRecipientError(null);
                  }}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  className="max-w-sm"
                />
                <Button variant="secondary" onClick={addRecipient}>
                  <Plus aria-hidden size={14} />
                  Add
                </Button>
              </div>
            </Field>
          )}
        </EditorSection>

        <EditorSection id="time" title="Time" lead="New schedules start in this time zone. Each schedule keeps its own zone once saved.">
          <Field label="Time zone" hint={canEdit ? undefined : "Ask an admin to change it."}>
            <TimezoneSelect value={d.timezone} disabled={!canEdit} onChange={(tz) => editor.set({ ...d, timezone: tz })} className="max-w-sm" />
          </Field>
        </EditorSection>

        <EditorSection id="account" title="Your account" lead={`Signed in as ${me?.email ?? ""}. Your name shows to the people you work with.`}>
          <Field label="Your name" optional error={editor.errorFor("me.name")}>
            <Input
              value={d.myName}
              autoComplete="name"
              onChange={(e) => editor.set({ ...d, myName: e.target.value })}
              onBlur={() => editor.touch("me.name")}
              className="max-w-sm"
            />
          </Field>
        </EditorSection>

        <EditorSection id="leave" title="Leave workspace">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3.5">
            <div>
              <p className="text-sm font-medium text-ink">Leave {ws.name}</p>
              <p className="text-[13px] text-ink-muted">
                {role === "owner"
                  ? "An owner can leave once another owner exists. Your personal dashboards here are deleted."
                  : "You lose access. Your personal dashboards here are deleted."}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void leave()}>
              <LogOut aria-hidden size={14} />
              Leave…
            </Button>
          </div>
        </EditorSection>
      </EditorFrame>
      {dialog}
      {guardDialog}
    </>
  );
}
