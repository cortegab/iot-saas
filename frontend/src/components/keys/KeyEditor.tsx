"use client";

import { useCallback, useMemo } from "react";
import { mutate as revalidate } from "swr";
import { Ban, Link2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { CopyField } from "@/components/ui/SecretReveal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];

interface KeyDraft {
  name: string;
  role: "viewer" | "admin";
  expiry: "30" | "90" | "365" | "never";
}

const BLANK: KeyDraft = { name: "", role: "viewer", expiry: "90" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** API keys (DESIGN.md §8): create (name, role, expiry), then read-only —
 * keys can't be edited; to change one, create a new key and revoke the old. */
export function KeyEditor({
  keyId,
  mode,
  onClose,
  onCreated,
}: {
  /** null = new key. */
  keyId: string | null;
  mode: EditorMode;
  onClose?: () => void;
  /** Receives the one-time secret; the page shows it. */
  onCreated?: (result: ApiKeyCreateResponse) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const { confirm, dialog } = useConfirm();
  const { data: keys, error, mutate } = useApiSWR<ApiKey[]>("/api-keys");
  const isNew = keyId == null;
  const key = keys?.find((k) => k.id === keyId);

  const source = useMemo<KeyDraft | null>(() => (isNew ? BLANK : null), [isNew]);
  const validate = useCallback((d: KeyDraft): Validation => {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};
    if (!d.name.trim()) errors["key.name"] = "Name it after what uses it, like “Grafana read-only”.";
    else if (d.name.trim().length > 100) errors["key.name"] = "Keep the name under 100 characters.";
    if (d.expiry === "never") warnings["key.expiry"] = "Keys that never expire are easy to forget. Prefer a date.";
    return { errors, warnings };
  }, []);
  const editor = useRecordEditor({ source, isNew, validate });
  const { confirmLeave, dialog: guardDialog } = useUnsavedGuard(editor.dirty, "this key");

  const close = useCallback(async () => {
    if (await confirmLeave()) onClose?.();
  }, [confirmLeave, onClose]);

  async function onSave(): Promise<boolean> {
    return editor
      .save(async (d) => {
        try {
          const result = await api.post<ApiKeyCreateResponse>("/api-keys", {
            name: d.name.trim(),
            role: d.role,
            expires_in_days: d.expiry === "never" ? null : Number(d.expiry),
          });
          await mutate();
          void revalidate("/api-keys");
          toast({ title: "API key created", detail: `${result.api_key.name} · ${ROLE_LABEL[d.role]}` });
          onCreated?.(result);
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the key", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function revoke() {
    if (!key) return;
    const ok = await confirm(
      <>
        Requests using <code className="font-mono">{key.key_prefix}…</code> fail from now on. Last used{" "}
        {key.last_used_at ? timeAgo(key.last_used_at) : "never"}.
      </>,
      { title: `Revoke ${key.name}?`, confirmLabel: "Revoke key" },
    );
    if (!ok) return;
    try {
      await api.delete(`/api-keys/${key.id}`);
      await mutate();
      toast({ title: "Key revoked", detail: key.name });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't revoke the key", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState title="Couldn't load this key" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      </div>
    );
  }

  if (!isNew) {
    if (!key) {
      return (
        <div className="p-5">
          <LoadingSkeleton rows={4} rowClassName="h-9" />
        </div>
      );
    }
    const st = keyStatus(key);
    const role = toRole(key.role);
    return (
      <>
        <EditorFrame
          mode={mode}
          noun="key"
          title={key.name}
          eyebrow={
            <>
              API key <Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />
            </>
          }
          consequence="Keys can't be edited. To change a key's role or expiry, create a new one and revoke this one."
          sections={[{ id: "key", label: "Key" }]}
          status={editor}
          readOnly
          readOnlyNote={false}
          onSave={() => Promise.resolve(false)}
          onDiscard={() => undefined}
          onClose={onClose}
          menu={[
            [
              {
                label: "Copy link",
                icon: <Link2 size={15} />,
                onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/keys?edit=${key.id}`).then(() => toast({ tone: "info", title: "Link copied" })),
              },
            ],
          ]}
        >
          <EditorSection id="key" title="Key">
            <dl className="flex flex-col">
              <Fact label="Prefix">
                <CopyField value={`${key.key_prefix}…`} label="key prefix" />
              </Fact>
              <Fact label="Role">{role ? ROLE_LABEL[role] : key.role}</Fact>
              <Fact label="Created">{formatWhen(key.created_at)}</Fact>
              <Fact label="Last used">{key.last_used_at ? timeAgo(key.last_used_at) : "Never"}</Fact>
              <Fact label="Expires">{key.expires_at ? formatDate(key.expires_at) : "Never"}</Fact>
              {key.revoked_at && <Fact label="Revoked">{formatWhen(key.revoked_at)}</Fact>}
              <Fact label="Header">
                <code className="break-all font-mono text-[12.5px]">Authorization: Bearer {key.key_prefix}…</code>
              </Fact>
            </dl>
            <p className="text-[13px] text-ink-muted">
              The key names its workspace, so <code className="font-mono">X-Tenant-Id</code> is optional. It works on devices, telemetry,
              rules, templates, zones and notifications, never on members, keys or personal dashboards.
            </p>
            {st === "active" && can("keys.manage") ? (
              <div>
                <Button variant="danger" onClick={() => void revoke()}>
                  <Ban aria-hidden size={14} />
                  Revoke key
                </Button>
              </div>
            ) : st !== "active" ? (
              <p className="text-[13px] text-ink-muted">{st === "revoked" ? "Revoked" : "Expired"} keys stay listed for audit.</p>
            ) : null}
          </EditorSection>
        </EditorFrame>
        {dialog}
      </>
    );
  }

  const d = editor.draft;
  if (!d) return null;
  return (
    <>
      <EditorFrame
        mode={mode}
        noun="key"
        title={d.name.trim() || "New API key"}
        eyebrow="New API key"
        consequence="The key is shown once when created. Only a hash is stored."
        sections={[{ id: "key", label: "Key" }]}
        status={editor}
        saveLabel="Create key"
        onSave={onSave}
        onDiscard={editor.discard}
        onClose={onClose ? () => void close() : undefined}
      >
        <EditorSection id="key" title="Key">
          <Field label="Name" error={editor.errorFor("key.name")}>
            <Input
              autoFocus
              value={d.name}
              placeholder="Grafana read-only"
              onChange={(e) => editor.set({ ...d, name: e.target.value })}
              onBlur={() => editor.touch("key.name")}
            />
          </Field>
          <div className="grid gap-3.5 @md:grid-cols-2">
            <Field label="Role" hint="Keys can never be Owner.">
              <Select value={d.role} onChange={(e) => editor.set({ ...d, role: e.target.value as KeyDraft["role"] })}>
                <option value="viewer">Viewer: read only</option>
                <option value="admin">Admin: read and write</option>
                <option value="owner" disabled>
                  Owner: not available for keys
                </option>
              </Select>
            </Field>
            <Field label="Expires" warning={editor.warningFor("key.expiry")}>
              <Select value={d.expiry} onChange={(e) => editor.set({ ...d, expiry: e.target.value as KeyDraft["expiry"] })}>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In 1 year</option>
                <option value="never">Never</option>
              </Select>
            </Field>
          </div>
        </EditorSection>
      </EditorFrame>
      {guardDialog}
    </>
  );
}
