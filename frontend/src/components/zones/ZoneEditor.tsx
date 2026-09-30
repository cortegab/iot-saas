"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Cpu, Link2, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

interface ZoneDraft {
  name: string;
  notes: string;
}

const DIFF: DiffField<ZoneDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Notes", get: (d) => d.notes.trim() },
];

const BLANK: ZoneDraft = { name: "", notes: "" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A zone: name and notes only (DESIGN.md §8). Devices are assigned from
 * their own settings, never from here. */
export function ZoneEditor({
  zoneId,
  mode,
  onClose,
  onCreated,
}: {
  /** null = new zone. */
  zoneId: string | null;
  mode: EditorMode;
  onClose?: () => void;
  onCreated?: (id: string) => void;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("zones.write");
  const { confirm, dialog } = useConfirm();
  const { data: zone, error, mutate } = useApiSWR<ZoneResponse>(zoneId ? `/zones/${zoneId}` : null);
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");

  const isNew = zoneId == null;
  const source = useMemo<ZoneDraft | null>(
    () => (isNew ? BLANK : zone ? { name: zone.name, notes: zone.notes ?? "" } : null),
    [isNew, zone],
  );
  const otherNames = useMemo(() => (zones ?? []).filter((z) => z.id !== zoneId).map((z) => z.name.toLowerCase()), [zones, zoneId]);
  const validate = useCallback(
    (d: ZoneDraft): Validation => {
      const errors: Record<string, string> = {};
      const name = d.name.trim();
      if (!name) errors["zone.name"] = "Give the zone a name.";
      else if (name.length > 80) errors["zone.name"] = "Keep the name under 80 characters.";
      else if (otherNames.includes(name.toLowerCase())) errors["zone.name"] = "Another zone already has this name.";
      if (d.notes.length > 1000) errors["zone.notes"] = "Keep notes under 1,000 characters.";
      return { errors };
    },
    [otherNames],
  );
  const editor = useRecordEditor({ source, isNew, validate });
  const { confirmLeave, dialog: guardDialog } = useUnsavedGuard(editor.dirty, zone?.name ?? "this zone");

  const close = useCallback(async () => {
    if (await confirmLeave()) onClose?.();
  }, [confirmLeave, onClose]);

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor
      .save(async (d) => {
        const body = { name: d.name.trim(), notes: d.notes.trim() || null };
        try {
          if (isNew) {
            const created = await api.post<ZoneResponse>("/zones", body);
            void revalidate("/zones");
            toast({ title: "Zone created", detail: created.name });
            onCreated?.(created.id);
          } else {
            await api.patch(`/zones/${zoneId}`, body);
            await mutate();
            void revalidate("/zones");
            void revalidate("/devices");
            toast({ title: "Zone saved", detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
          }
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function remove() {
    if (!zone) return;
    if (zone.device_count > 0) {
      const go = await confirm(`${plural(zone.device_count, "device is", "devices are")} assigned to it. Move them to another zone from their settings first.`, {
        title: `${zone.name} is in use`,
        confirmLabel: "View its devices",
        cancelLabel: "Close",
        danger: false,
      });
      if (go) router.push(`/devices?zone=${zone.id}`);
      return;
    }
    if (!(await confirm("No devices are assigned to it.", { title: `Delete ${zone.name}?`, confirmLabel: "Delete zone" }))) return;
    try {
      await api.delete(`/zones/${zone.id}`);
      void revalidate("/zones");
      toast({ title: `${zone.name} deleted` });
      onClose?.();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the zone", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState title="Couldn't load this zone" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      </div>
    );
  }
  const d = editor.draft;
  if (!d) {
    return (
      <div className="p-5">
        <LoadingSkeleton rows={3} rowClassName="h-10" />
      </div>
    );
  }

  const devices = zone?.device_count ?? 0;
  return (
    <>
      <EditorFrame
        mode={mode}
        noun="zone"
        title={d.name.trim() || (isNew ? "New zone" : zone!.name)}
        eyebrow={<>Zone{!isNew && <span>· {plural(devices, "device")}</span>}</>}
        consequence={isNew ? "Once it exists, pick it in a device's settings." : devices ? `Renaming updates the zone shown on its ${plural(devices, "device")}.` : "No devices are in this zone yet."}
        sections={[{ id: "zone", label: "Zone" }]}
        status={editor}
        readOnly={readOnly}
        saveLabel={isNew ? "Create zone" : "Save"}
        onSave={onSave}
        onDiscard={editor.discard}
        onClose={onClose ? () => void close() : undefined}
        menu={
          isNew
            ? undefined
            : [
                [
                  { label: "View its devices", icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${zoneId}`) },
                  {
                    label: "Copy link",
                    icon: <Link2 size={15} />,
                    onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/zones?edit=${zoneId}`).then(() => toast({ tone: "info", title: "Link copied" })),
                  },
                ],
                ...(readOnly ? [] : [[{ label: "Delete zone…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }]]),
              ]
        }
      >
        <EditorSection id="zone" title="Zone">
          <Field label="Name" error={editor.errorFor("zone.name")}>
            <Input value={d.name} disabled={readOnly} placeholder="e.g. Greenhouse bay 1" onChange={(e) => editor.set({ ...d, name: e.target.value })} onBlur={() => editor.touch("zone.name")} />
          </Field>
          <Field label="Notes" optional error={editor.errorFor("zone.notes")} hint="Where it is, who looks after it, anything the next person should know.">
            <Textarea rows={4} value={d.notes} disabled={readOnly} onChange={(e) => editor.set({ ...d, notes: e.target.value })} onBlur={() => editor.touch("zone.notes")} />
          </Field>
          {!isNew && (
            <p className="text-[13px] text-ink-muted">
              Devices join a zone from their own settings.{" "}
              {devices > 0 && (
                <Link href={`/devices?zone=${zoneId}`} className="text-accent hover:underline">
                  View its {plural(devices, "device")}
                </Link>
              )}
            </p>
          )}
        </EditorSection>
      </EditorFrame>
      {dialog}
      {guardDialog}
    </>
  );
}
