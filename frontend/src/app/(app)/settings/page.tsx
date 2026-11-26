"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { LogOut, Mail, Plus, X } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { CopyField } from "@/components/ui/SecretReveal";
import { TimezoneSelect } from "@/components/ui/TimezoneSelect";
import { Select } from "@/components/ui/Select";
import { useLanguage } from "@/hooks/useLanguage";
import { useT } from "@/lib/i18n";
import { LOCALES, LOCALE_NAMES, isLocale } from "@iodriven/shared/i18n";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type UserResponse = components["schemas"]["UserResponse"];
type TenantResponse = components["schemas"]["TenantResponse"];

interface SettingsDraft {
  name: string;
  recipients: string[];
  timezone: string;
  myName: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DIFF: DiffField<SettingsDraft>[] = [
  { get label() { return tr("settings.diff.name"); }, get: (d) => d.name.trim() },
  { get label() { return tr("settings.diff.recipients"); }, get: (d) => d.recipients.join(", ") || tr("settings.diff.none") },
  { get label() { return tr("settings.diff.timezone"); }, get: (d) => d.timezone },
  { get label() { return tr("settings.diff.myName"); }, get: (d) => d.myName.trim() },
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
    if (!d.name.trim()) errors["ws.name"] = tr("settings.nameRequired");
    else if (d.name.trim().length > 100) errors["ws.name"] = tr("settings.nameLong");
    if (d.myName.length > 100) errors["me.name"] = tr("settings.myNameLong");
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
          toast({ title: tr("settings.saved"), detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
        } catch (err) {
          toast({ tone: "error", title: tr("settings.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function leave() {
    if (!ws) return;
    const ok = await confirm(tr("settings.leaveBody"), {
      title: tr("settings.leaveTitle", { name: ws.name }),
      confirmLabel: tr("settings.leaveConfirm"),
    });
    if (!ok) return;
    try {
      await api.post("/tenants/leave");
      await revalidate(() => true, undefined, { revalidate: false });
      await refresh();
      toast({ title: tr("settings.left", { name: ws.name }) });
      router.replace("/devices");
    } catch (err) {
      toast({
        tone: "error",
        title: tr("settings.leaveFailed"),
        detail: err instanceof ApiRequestError ? err.message : undefined,
      });
    }
  }

  if (error) {
    return (
      <ErrorState title={tr("settings.loadFailed")} message={error instanceof ApiRequestError ? error.message : tr("devices.apiDown")} onRetry={() => void mutate()} />
    );
  }
  const d = editor.draft;
  if (!d || !ws) return <LoadingSkeleton rows={5} rowClassName="h-14" />;

  function addRecipient() {
    if (!d) return;
    const v = recipient.trim().toLowerCase();
    if (!EMAIL.test(v)) return setRecipientError(tr("settings.badEmail"));
    if (d.recipients.includes(v)) return setRecipientError(tr("settings.already"));
    if (d.recipients.length >= 50) return setRecipientError(tr("settings.max"));
    editor.set({ ...d, recipients: [...d.recipients, v] });
    setRecipient("");
    setRecipientError(null);
  }

  return (
    <>
      <EditorFrame
        mode="page"
        noun="settings"
        title={tr("settings.title")}
        consequence={`Applies to everyone in ${ws.name}.`}
        sections={[
          { id: "workspace", label: tr("settings.sections.workspace") },
          { id: "alerts", label: tr("settings.sections.alerts"), count: d.recipients.length },
          { id: "time", label: tr("settings.sections.time") },
          ...(canEdit ? [{ id: "setup", label: tr("settings.sections.setup") }] : []),
          { id: "account", label: tr("settings.sections.account") },
          { id: "leave", label: tr("settings.sections.leave") },
        ]}
        sectionOf={(p) => (p.startsWith("me.") ? "account" : "workspace")}
        status={editor}
        saveLabel={tr("ui.save")}
        nav="plain"
        onSave={onSave}
        onDiscard={editor.discard}
      >
        {/* Plain stacked sections divided by hairlines (demo H). */}
        <div className="flex flex-col gap-7">
        <EditorSection id="workspace" title={tr("settings.sections.workspace")} lead={tr("settings.workspaceLead")}>
          <div className="grid gap-3.5 @xl:grid-cols-2">
            <Field
              label={tr("settings.name")}
              error={editor.errorFor("ws.name")}
              hint={canRename ? undefined : tr("settings.askOwner")}
            >
              <Input
                value={d.name}
                disabled={!canRename}
                onChange={(e) => editor.set({ ...d, name: e.target.value })}
                onBlur={() => editor.touch("ws.name")}
              />
            </Field>
            <Field label={tr("settings.prefix")} hint={tr("settings.prefixHint")}>
              <CopyField value={`${ws.slug}/`} label={tr("settings.prefixCopy")} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection
          id="alerts"
          title={tr("settings.sections.alerts")}
          lead={tr("settings.alertsLead")}
        >
          <ul className="flex flex-wrap gap-1.5" aria-label={tr("settings.recipients")}>
            {d.recipients.length === 0 && <li className="text-sm text-ink-muted">Nobody listed: owners and admins get the alerts.</li>}
            {d.recipients.map((r) => (
              <li
                key={r}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-2.5 pr-1 text-meta text-ink"
              >
                <Mail aria-hidden size={12} className="text-ink-muted" />
                {r}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={tr("settings.remove", { email: r })}
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
            <Field label={tr("settings.addRecipient")} error={recipientError}>
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
                  {tr("settings.add")}
                </Button>
              </div>
            </Field>
          )}
          <EmailLanguageField canEdit={canEdit} />
        </EditorSection>

        <EditorSection id="time" title={tr("settings.sections.time")} lead={tr("settings.timeLead")}>
          <Field label={tr("settings.timezone")} hint={canEdit ? undefined : tr("settings.askAdmin")}>
            <TimezoneSelect value={d.timezone} disabled={!canEdit} onChange={(tz) => editor.set({ ...d, timezone: tz })} className="max-w-sm" />
          </Field>
        </EditorSection>

        {canEdit && (
          <EditorSection id="setup" title={tr("settings.sections.setup")} lead={tr("settings.setupLead")}>
            <div>
              <Link href="/start" className={buttonClassName({ variant: "secondary" })}>
                {tr("settings.openSetup")}
              </Link>
            </div>
          </EditorSection>
        )}

        <EditorSection id="account" title={tr("settings.sections.account")} lead={tr("settings.accountLead", { email: me?.email ?? "" })}>
          <Field label={tr("settings.yourName")} optional error={editor.errorFor("me.name")}>
            <Input
              value={d.myName}
              autoComplete="name"
              onChange={(e) => editor.set({ ...d, myName: e.target.value })}
              onBlur={() => editor.touch("me.name")}
              className="max-w-sm"
            />
          </Field>
          <LanguageField />
        </EditorSection>

        <EditorSection id="leave" title={tr("settings.sections.leave")} tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-meta text-ink-muted">
              {role === "owner"
                ? tr("settings.leaveOwner")
                : tr("settings.leaveOther")}
            </p>
            <Button variant="secondary-danger" onClick={() => void leave()}>
              <LogOut aria-hidden size={14} />
              {tr("settings.leaveDots")}
            </Button>
          </div>
        </EditorSection>
        </div>
      </EditorFrame>
      {dialog}
      {guardDialog}
    </>
  );
}

/** Settings → You → Language (DESIGN.md §11a): applies at once, saved on the
 * account so it follows you to other browsers, the app and your emails. */
function LanguageField() {
  const t = useT();
  const { choice, setChoice } = useLanguage();
  return (
    <Field label={t("language.label")} hint={t("language.hint")}>
      <Select
        value={choice ?? ""}
        onChange={(e) => void setChoice(isLocale(e.target.value) ? e.target.value : null)}
        className="max-w-sm"
      >
        <option value="">{t("language.browser")}</option>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Settings → Alerts → Email language (DESIGN.md §11a): the language of
 * rule emails to the listed addresses, which have no account to ask.
 * Applies at once, like Language. */
function EmailLanguageField({ canEdit }: { canEdit: boolean }) {
  const api = useApi();
  const toast = useToast();
  const { data: ws, mutate } = useWorkspace();
  if (!ws) return null;
  async function change(next: string) {
    if (!isLocale(next)) return;
    try {
      await mutate(await api.patch<TenantResponse>("/tenants/current", { locale: next }), { revalidate: false });
      toast({ title: tr("settings.emailLanguageSaved") });
    } catch (err) {
      toast({ tone: "error", title: tr("settings.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }
  return (
    <Field label={tr("settings.emailLanguage")} hint={canEdit ? tr("settings.emailLanguageHint") : tr("settings.askAdmin")}>
      <Select value={ws.locale ?? "en"} disabled={!canEdit} onChange={(e) => void change(e.target.value)} className="max-w-sm">
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
