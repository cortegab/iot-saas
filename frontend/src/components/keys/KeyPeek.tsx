"use client";

import Link from "next/link";
import { Ban, Copy, Eye, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { PeekFrame, PeekPlaceholder } from "@/components/editor/PeekFrame";
import { KEY_STATUS_LABEL, KEY_STATUS_TONE, keyStatus, type ApiKey } from "@/lib/api-key-status";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/time-ago";
import { useRevokeKey } from "./useRevokeKey";

/** An API key at a glance; its page is /keys/{id}. */
export function KeyPeek({ apiKey, onClose }: { apiKey: ApiKey | undefined; onClose: () => void }) {
  const toast = useToast();
  const { revoke, dialog } = useRevokeKey();
  if (!apiKey) return <PeekPlaceholder noun="key" missing onClose={onClose} />;

  const st = keyStatus(apiKey);
  const role = toRole(apiKey.role);
  const copy = (text: string, title: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast({ tone: "info", title }),
      () => toast({ tone: "error", title: "Couldn't reach the clipboard", detail: text }),
    );
  const menu: DropdownMenuItem[][] = [
    [
      { label: "Copy prefix", icon: <Copy size={15} />, onClick: () => copy(apiKey.key_prefix, "Prefix copied") },
      { label: "Copy link", icon: <Link2 size={15} />, onClick: () => copy(`${window.location.origin}/keys/${apiKey.id}`, "Link copied") },
    ],
    ...(st === "active" ? [[{ label: "Revoke…", icon: <Ban size={15} />, danger: true, onClick: () => void revoke(apiKey) }]] : []),
  ];

  return (
    <>
      <PeekFrame
        noun="key"
        title={apiKey.name}
        eyebrow={
          <>
            API key <Badge tone={KEY_STATUS_TONE[st]} label={KEY_STATUS_LABEL[st]} />
          </>
        }
        facts={[
          ["Prefix", <code key="p" className="font-mono text-[13px]">{apiKey.key_prefix}…</code>],
          ["Role", role ? ROLE_LABEL[role] : apiKey.role],
          ["Last used", apiKey.last_used_at ? timeAgo(apiKey.last_used_at) : "Never"],
          ["Expires", apiKey.expires_at ? formatDate(apiKey.expires_at) : "Never"],
          ["Created", formatDate(apiKey.created_at)],
        ]}
        primary={
          <Link href={`/keys/${apiKey.id}`} className={buttonClassName({ size: "sm" })}>
            <Eye aria-hidden size={14} /> Open key
          </Link>
        }
        menu={menu}
        onClose={onClose}
      />
      {dialog}
    </>
  );
}
