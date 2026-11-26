"use client";

import { Copy, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekOpen, PeekPlaceholder } from "@/components/editor/PeekFrame";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import { useRevokeKey } from "./useRevokeKey";
import { tActive as tr } from "@iodriven/shared/i18n";

/** An API key at a glance; its page is /keys/{id}. */
export function KeyPeek({ apiKey, onClose }: { apiKey: ApiKey | undefined; onClose: () => void }) {
  const toast = useToast();
  const { endItems, dialog } = useRevokeKey();
  if (!apiKey) return <PeekPlaceholder noun="key" missing onClose={onClose} />;

  const st = keyStatus(apiKey);
  const role = toRole(apiKey.role);
  const copy = (text: string, title: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast({ tone: "info", title }),
      () => toast({ tone: "error", title: tr("apik.clipboard"), detail: text }),
    );
  const menu: DropdownMenuItem[][] = [
    [
      { label: tr("apik.copyPrefix"), icon: <Copy size={15} />, onClick: () => copy(apiKey.key_prefix, tr("apik.prefixCopied")) },
      { label: tr("apik.copyLink"), icon: <Link2 size={15} />, onClick: () => copy(`${window.location.origin}/keys/${apiKey.id}`, tr("apik.linkCopied")) },
    ],
    ...endItems(apiKey, onClose),
  ];

  return (
    <>
      <PeekFrame
        noun="key"
        title={apiKey.name}
        eyebrow={
          <>
            <Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />
          </>
        }
        facts={[
          [tr("apik.prefix"), <code key="p" className="font-mono text-meta">{apiKey.key_prefix}…</code>],
          [tr("apik.role"), role ? ROLE_LABEL[role] : apiKey.role],
          [tr("apik.lastUsed"), apiKey.last_used_at ? timeAgo(apiKey.last_used_at) : tr("apik.never")],
          [tr("apik.expires"), apiKey.expires_at ? formatDate(apiKey.expires_at) : tr("apik.never")],
          [tr("apik.created2"), formatDate(apiKey.created_at)],
        ]}
        primary={<PeekOpen href={`/keys/${apiKey.id}`} noun="key" />}
        menu={menu}
        onClose={onClose}
      />
      {dialog}
    </>
  );
}
