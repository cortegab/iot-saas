"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { cn } from "@/lib/cn";
import { usageText, type ActuatorDraft, type MetricDraft } from "@/lib/template-draft";

export type RowKind = "metrics" | "actuators";
type Row = MetricDraft | ActuatorDraft;

/** Which of a section's rows are open. A row with an error, a new row and a
 * row the author opened always are; otherwise "Expand/Collapse all" decides,
 * and short lists on a full page start open. */
export function useRowExpansion(kind: RowKind, { d, editor, mode }: Pick<SectionProps, "d" | "editor" | "mode">) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState<boolean | null>(null);
  // Keys the author unlocked; kept while a row is collapsed.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const rows: Row[] = d[kind];

  const isOpen = (row: Row, i: number) => {
    const hasError = editor.visibleErrors.some((p) => p.startsWith(`${kind}.${i}.`));
    if (hasError || expanded.has(row.uid) || row.origKey == null) return true;
    if (allOpen != null) return allOpen;
    return mode === "page" && rows.length <= 3;
  };
  const edit = (uid: string, open: boolean) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (open) n.add(uid);
      else n.delete(uid);
      return n;
    });
  const openNow = rows.every((r, i) => isOpen(r, i));
  const toggleAll =
    rows.length < 2 ? undefined : (
      <Button
        variant="link"
        className="inline-flex items-center gap-1 text-[12.5px] font-medium"
        onClick={() => {
          setExpanded(new Set());
          setAllOpen(!openNow);
        }}
      >
        {openNow ? <ChevronDown aria-hidden size={13} /> : <ChevronRight aria-hidden size={13} />}
        {openNow ? "Collapse all" : "Expand all"}
      </Button>
    );

  return {
    isOpen,
    toggle: (uid: string) => edit(uid, !expanded.has(uid)),
    open: (uid: string) => edit(uid, true),
    collapse: (uid: string) => {
      edit(uid, false);
      setAllOpen(false);
    },
    toggleAll,
    isUnlocked: (uid: string) => unlocked.has(uid),
    unlock: (uid: string) => setUnlocked((s) => new Set(s).add(uid)),
  };
}

/** A row's key: follows the name until edited, locked while something uses
 * it (with Unlock), and shows its MQTT topic. */
export function KeyField({
  kind,
  i,
  row,
  topic,
  onChange,
  unlocked,
  onUnlock,
  props,
}: {
  kind: RowKind;
  i: number;
  row: Row;
  topic: string;
  onChange: (key: string) => void;
  unlocked: boolean;
  onUnlock: () => void;
  props: SectionProps;
}) {
  const { f, blur, readOnly, usage } = props;
  const path = `${kind}.${i}.key`;
  const used = row.origKey ? usageText(usage?.[kind][row.origKey]) : "";
  const locked = !!used && !unlocked && row.key === row.origKey;
  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          Key {row.keyAuto && <Tag size="sm">auto</Tag>}
          {locked && <Lock aria-label="Locked: in use" size={11} />}
        </span>
      }
      {...f(path)}
      hint={
        <>
          <span className="font-mono">{topic}</span>
          {used && <> · used by {used}</>}
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input mono value={row.key} disabled={readOnly || locked} onChange={(e) => onChange(e.target.value)} onBlur={blur(path)} />
        {locked && !readOnly && (
          <Button variant="link" className="shrink-0 text-xs" onClick={onUnlock}>
            Unlock
          </Button>
        )}
      </div>
    </Field>
  );
}

/** A collapsed row: name, one-line description, key, usage and problems. */
export function RowSummary({ kind, i, row, desc, onOpen, props }: { kind: RowKind; i: number; row: Row; desc: string; onOpen: () => void; props: SectionProps }) {
  const { editor, usage } = props;
  const used = row.origKey ? usageText(usage?.[kind][row.origKey]) : "";
  const hasErr = Object.keys(editor.errors).some((p) => p.startsWith(`${kind}.${i}.`));
  const hasWarn = !!editor.warningFor(`${kind}.${i}.key`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full min-w-0 items-center gap-2.5 rounded-xl border bg-surface py-2.5 pl-3 pr-2.5 text-left hover:border-accent/40",
        hasErr ? "border-status-error" : "border-border",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-ink">{row.name || <span className="text-ink-muted">Unnamed</span>}</span>
        <span className="truncate text-[12.5px] text-ink-muted">{desc}</span>
      </span>
      {row.key && (
        <Tag mono className="max-w-[40%] truncate max-sm:hidden">
          {row.key}
        </Tag>
      )}
      {used && <span className="whitespace-nowrap text-[11.5px] text-ink-muted max-sm:hidden">used by {used}</span>}
      {hasErr && <AlertCircle aria-label="Has errors" size={15} className="text-status-error" />}
      {!hasErr && hasWarn && <AlertTriangle aria-label="Has warnings" size={15} className="text-status-pending" />}
      <span className="inline-flex items-center gap-1 text-ink-muted group-hover:text-accent-strong">
        <span className="hidden text-xs font-semibold group-hover:inline">Edit</span>
        <ChevronRight aria-hidden size={15} />
      </span>
    </button>
  );
}

/** An open row: its fields in a card with Collapse and Remove. */
export function RowCard({ title, onCollapse, onRemove, readOnly, children }: { title: string; onCollapse: () => void; onRemove: () => void; readOnly: boolean; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-xl border border-border bg-surface px-3.5 pb-3.5 pt-3">
      <legend className="sr-only">{title}</legend>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={onCollapse} aria-label="Collapse" className="-ml-1.5 grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-surface-raised">
          <ChevronDown aria-hidden size={15} />
        </button>
        <span className="flex-1 truncate text-sm font-medium text-ink">{title}</span>
        {!readOnly && (
          <Button variant="link-danger" className="text-[12.5px]" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">{children}</div>
    </fieldset>
  );
}
