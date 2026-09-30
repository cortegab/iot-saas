"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Eye, EyeOff } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A read-only mono value with a copy button (topics, prefixes, key
 * prefixes). */
export function CopyField({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible name for the copy button's target ("topic"). */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised py-1 pl-2.5 pr-1",
        className,
      )}
    >
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[12.5px] text-ink">{value}</code>
      <button
        type="button"
        aria-label={copied ? "Copied" : `Copy ${label ?? "value"}`}
        onClick={() =>
          void copyText(value).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-ink"
      >
        {copied ? <Check aria-hidden size={14} className="text-status-online" /> : <Copy aria-hidden size={14} />}
      </button>
    </div>
  );
}

export interface SecretField {
  label: string;
  value: string;
  /** Mask until "Show" is pressed (the secret half of a credential). */
  secret?: boolean;
}

export interface SecretRevealProps {
  /** e.g. "New credential for bay1-climate". */
  title?: ReactNode;
  fields: SecretField[];
  /** What the copy button puts on the clipboard. Default: "label: value" lines,
   * or the bare value when there is one field. */
  copyValue?: string;
  copyLabel?: string;
  /** Renders a dismiss button. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Require a copy (or "I've stored it") before dismiss is enabled. */
  requireAcknowledge?: boolean;
  className?: string;
}

/** DESIGN.md §5 CopyField / SecretReveal — the one component for every
 * one-time secret (device credential, API key). Shown once, with a copy
 * button and a "won't be shown again" warning. */
export function SecretReveal({
  title,
  fields,
  copyValue,
  copyLabel = "Copy",
  onDismiss,
  dismissLabel = "Done",
  requireAcknowledge = false,
  className,
}: SecretRevealProps) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState(false);
  const hasMasked = fields.some((f) => f.secret);
  const clipboard =
    copyValue ?? (fields.length === 1 ? fields[0].value : fields.map((f) => `${f.label}: ${f.value}`).join("\n"));
  const acknowledged = copied || stored;

  return (
    <div
      role="region"
      aria-label="One-time secret"
      className={cn(
        "flex flex-col gap-3 rounded-md border border-status-pending/45 bg-status-pending-surface p-3.5",
        className,
      )}
    >
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0 text-status-pending" />
        <div>
          {title && <p className="font-medium text-ink">{title}</p>}
          <p className={title ? "text-ink-muted" : "font-medium text-ink"}>
            Copy it now — it won&apos;t be shown again.
          </p>
        </div>
      </div>

      <dl className="grid gap-1.5">
        {fields.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <dt className="w-24 shrink-0 text-xs text-ink-muted">{f.label}</dt>
            <dd className="min-w-0 flex-1 select-all break-all font-mono text-[12.5px] text-ink">
              {f.secret && !shown ? "•".repeat(Math.min(f.value.length, 32)) : f.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copyText(clipboard).then((ok) => ok && setCopied(true))}
          className={buttonClassName({ variant: "primary", size: "sm" })}
        >
          {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
          {copied ? "Copied" : copyLabel}
        </button>
        {hasMasked && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {shown ? <EyeOff aria-hidden size={14} /> : <Eye aria-hidden size={14} />}
            {shown ? "Hide" : "Show"}
          </button>
        )}
        {requireAcknowledge && (
          <label className="ml-1 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={stored}
              onChange={(e) => setStored(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            I&apos;ve stored it
          </label>
        )}
        {onDismiss && (
          <button
            type="button"
            disabled={requireAcknowledge && !acknowledged}
            onClick={onDismiss}
            className={cn(buttonClassName({ variant: "ghost", size: "sm" }), "ml-auto")}
          >
            {dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}
