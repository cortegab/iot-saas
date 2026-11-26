"use client";

import { useCallback, useMemo } from "react";
import { mutate as revalidate } from "swr";
import { Ban, Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { FactList } from "@/components/ui/FactList";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { CopyField } from "@/components/ui/SecretReveal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { useRevokeKey } from "./useRevokeKey";
import { ApiRequestError } from "@/lib/api-client";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, formatWhen, timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { NotFound } from "@/components/ui/NotFound";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponse"];

interface KeyDraft {
  name: string;
  role: "viewer" | "admin";
  expiry: "30" | "90" | "365" | "never";
}

const BLANK: KeyDraft = { name: "", role: "viewer", expiry: "90" };

/** API keys (DESIGN.md §8), on their own pages: create (/keys/new: name,
 * role, expiry), then read-only (/keys/{id}) — keys can't be edited; to
 * change one, create a new key and revoke the old. */
export function KeyEditor({
  keyId,
  mode = "page",
  onCreated,
}: {
  /** null = new key. */
  keyId: string | null;
  mode?: EditorMode;
  /** Receives the one-time secret; the page shows it. */
  onCreated?: (result: ApiKeyCreateResponse) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const router = useRouter();
  const { revoke, remove, endItems, dialog } = useRevokeKey();
  const { data: keys, error, mutate } = useApiSWR<ApiKey[]>("/api-keys");
  const isNew = keyId == null;
  const key = keys?.find((k) => k.id === keyId);

  const source = useMemo<KeyDraft | null>(() => (isNew ? BLANK : null), [isNew]);
  const validate = useCallback((d: KeyDraft): Validation => {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};
    if (!d.name.trim()) errors["key.name"] = tr("apik.nameRequired");
    else if (d.name.trim().length > 100) errors["key.name"] = tr("apik.nameLong");
    if (d.expiry === "never") warnings["key.expiry"] = tr("apik.neverWarn");
    return { errors, warnings };
  }, []);
  const editor = useRecordEditor({ source, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, "this key");

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
          toast({ title: tr("apik.created"), detail: `${result.api_key.name} · ${ROLE_LABEL[d.role]}` });
          onCreated?.(result);
        } catch (err) {
          toast({ tone: "error", title: tr("apik.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState title={tr("apik.loadFailed")} message={error instanceof ApiRequestError ? error.message : tr("apik.noResponse")} onRetry={() => void mutate()} />
      </div>
    );
  }

  if (!isNew) {
    // The list has loaded and the key isn't in it: gone, not still loading.
    if (!key && keys) return <NotFound noun="key" href="/keys" list="API keys" />;
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
          eyebrow={<Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />}
          consequence={tr("apik.consView")}
          sections={[{ id: "key", label: tr("apik.key") }]}
          status={editor}
          readOnly
          readOnlyNote={false}
          onSave={() => Promise.resolve(false)}
          onDiscard={() => undefined}
          menu={[
            [
              {
                label: tr("apik.copyLink"),
                icon: <Link2 size={15} />,
                onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/keys/${key.id}`).then(() => toast({ tone: "info", title: tr("apik.linkCopied") })),
              },
            ],
            ...(can("keys.manage") ? endItems(key, () => router.push("/keys")) : []),
          ]}
        >
          <EditorSection id="key" title={tr("apik.key")}>
            <FactList
              facts={[
                [tr("apik.prefix"), <CopyField key="prefix" value={`${key.key_prefix}…`} label={tr("apik.prefixLabel")} />],
                [tr("apik.scope"), role ? ROLE_LABEL[role] : key.role],
                [tr("apik.created2"), formatWhen(key.created_at)],
                [tr("apik.lastUsed"), key.last_used_at ? timeAgo(key.last_used_at) : tr("apik.never")],
                [tr("apik.expires"), key.expires_at ? formatDate(key.expires_at) : tr("apik.never")],
                key.revoked_at ? [tr("apik.revoked"), formatWhen(key.revoked_at)] : null,
                [tr("apik.header"), <code key="header" className="break-all font-mono text-xs">Authorization: Bearer {key.key_prefix}…</code>],
              ]}
            />
            <p className="text-meta text-ink-muted">
              {richT(tr, "apik.tenantNote", { header: <code className="font-mono">X-Tenant-Id</code> })}
            </p>
            {st === "active" && can("keys.manage") ? (
              <div>
                <Button variant="secondary-danger" onClick={() => void revoke(key)}>
                  <Ban aria-hidden size={14} />
                  {tr("apik.revokeButton")}
                </Button>
              </div>
            ) : st !== "active" && can("keys.manage") ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary-danger" onClick={() => void remove(key, () => router.push("/keys"))}>
                  <Trash2 aria-hidden size={14} />
                  {tr("apik.deleteButton")}
                </Button>
                <span className="text-meta text-ink-muted">{tr("apik.cantAuth", { state: st === "revoked" ? tr("apik.revoked") : tr("apik.expired") })}</span>
              </div>
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
        title={tr("apik.newTitle")}
        consequence={tr("apik.consNew")}
        sections={[{ id: "key", label: tr("apik.key") }]}
        status={editor}
        saveLabel={tr("apik.create")}
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <EditorSection id="key" title={tr("apik.key")}>
          <div className="grid items-start gap-3.5 @md:grid-cols-2">
            <Field label={tr("apik.name")} error={editor.errorFor("key.name")} hint={tr("apik.nameHint")}>
              <Input autoFocus value={d.name} onChange={(e) => editor.set({ ...d, name: e.target.value })} onBlur={() => editor.touch("key.name")} />
            </Field>
            <Field label={tr("apik.expires")} warning={editor.warningFor("key.expiry")}>
              <Select value={d.expiry} onChange={(e) => editor.set({ ...d, expiry: e.target.value as KeyDraft["expiry"] })}>
                <option value="30">{tr("apik.in30")}</option>
                <option value="90">{tr("apik.in90")}</option>
                <option value="365">{tr("apik.inYear")}</option>
                <option value="never">{tr("apik.never")}</option>
              </Select>
            </Field>
          </div>
          {/* demo H: Viewer | Admin; keys can never be Owner. */}
          <div className="flex flex-col gap-[5px]">
            <span className="text-meta font-medium text-ink">{tr("apik.scope")}</span>
            <SegmentedControl
              ariaLabel={tr("apik.scope")}
              size="md"
              value={d.role}
              onChange={(role) => editor.set({ ...d, role })}
              options={[
                { value: "viewer", label: ROLE_LABEL.viewer },
                { value: "admin", label: ROLE_LABEL.admin },
              ]}
            />
            <span className={d.role === "admin" ? "text-xs text-status-pending" : "text-xs text-ink-muted"}>
              {d.role === "admin" ? tr("apik.adminHint") : tr("apik.readOnly")}
            </span>
          </div>
        </EditorSection>
      </EditorFrame>
      {guardDialog}
    </>
  );
}
