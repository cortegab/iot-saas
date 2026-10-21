"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LineRow } from "@/components/ui/LineRow";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { usageText, type ActuatorDraft, type MetricDraft } from "@/lib/template-draft";

export type RowKind = "metrics" | "actuators";
type Row = MetricDraft | ActuatorDraft;

/** Which row's item sheet is open (DESIGN.md §7: one item at a time), and
 * the keys the author unlocked. */
export function useRowSheet() {
  const [openUid, setOpenUid] = useState<string | null>(null);
  // Keys the author unlocked; kept while the sheet is closed.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  return {
    openUid,
    open: (uid: string) => setOpenUid(uid),
    close: () => setOpenUid(null),
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

/** A row as one line (DESIGN.md §5 Line row): name, then key · what it is ·
 * who uses it, its Not wired tag and its problems. Opens its sheet. */
export function RowLine({
  kind,
  i,
  row,
  desc,
  onOpen,
  selected,
  props,
}: {
  kind: RowKind;
  i: number;
  row: Row;
  desc: string;
  onOpen: () => void;
  selected: boolean;
  props: SectionProps;
}) {
  const { editor, usage } = props;
  const used = row.origKey ? usageText(usage?.[kind][row.origKey]) : "";
  const issues = editor.visibleErrors.filter((p) => p.startsWith(`${kind}.${i}.`)).length;
  const warn = !!editor.warningFor(`${kind}.${i}.key`);
  return (
    <LineRow
      title={row.name || <span className="text-ink-muted">Unnamed</span>}
      sub={
        <>
          <span className="font-mono">{row.key || "no key"}</span>
          {desc && ` · ${desc}`}
          {used && ` · used by ${used}`}
        </>
      }
      end={notWired(kind, row, props) ? <NotWiredTag /> : undefined}
      issues={issues}
      warn={warn}
      selected={selected}
      onOpen={onOpen}
    />
  );
}

/** In an our-firmware template with wiring, a row no part feeds (or drives):
 * the firmware won't publish it unless something else does (DESIGN.md §8). */
export function notWired(kind: RowKind, row: Row, { d }: Pick<SectionProps, "d">): boolean {
  if (d.runsOn !== "generic_firmware" || !d.hardware) return false;
  const bindings = kind === "metrics" ? d.hardware.inputs : d.hardware.outputs;
  return !bindings.some((b) => Object.values(b.channels).includes(row.uid));
}

function NotWiredTag() {
  return (
    <span title="No part feeds this. Your firmware must publish it.">
      <Tag size="sm">Not wired</Tag>
    </span>
  );
}

/** A row's item sheet: its fields, edited live in the draft, with Remove and
 * Done (DESIGN.md §7: no save of its own). */
export function RowSheet({
  title,
  sub,
  open,
  onClose,
  onRemove,
  readOnly,
  unwired = false,
  children,
}: {
  title: string;
  sub: string;
  open: boolean;
  onClose: () => void;
  onRemove: () => void;
  readOnly: boolean;
  /** Tag it "Not wired" (see notWired). */
  unwired?: boolean;
  children: ReactNode;
}) {
  return (
    <ItemSheet
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      footer={
        <>
          {!readOnly && (
            <Button
              variant="link-danger"
              className="mr-auto text-[13px]"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {unwired && (
        <p className="mb-4 flex items-center gap-2 text-[13px] text-ink-muted">
          <NotWiredTag /> No part feeds this. Your firmware must publish it.
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 @[640px]:grid-cols-4">{children}</div>
    </ItemSheet>
  );
}
