"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Cpu, Link2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState } from "@/components/ui/ErrorState";
import { FactList } from "@/components/ui/FactList";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { useDeleteZone } from "./useDeleteZone";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";
import { NotFound, isNotFound } from "@/components/ui/NotFound";
import { tActive as tr } from "@iodriven/shared/i18n";

type ZoneResponse = components["schemas"]["ZoneResponse"];

interface ZoneDraft {
  name: string;
  notes: string;
}

const DIFF: DiffField<ZoneDraft>[] = [
  { get label() { return tr("zone.name"); }, get: (d) => d.name.trim() },
  { get label() { return tr("zone.notes"); }, get: (d) => d.notes.trim() },
];

const BLANK: ZoneDraft = { name: "", notes: "" };

/** A zone: name and notes only (DESIGN.md §8), edited on its own page
 * (/zones/new, /zones/{id}); the list only peeks. Devices are assigned from
 * their own settings, never from here. */
export function ZoneEditor({
  zoneId,
  mode = "page",
}: {
  /** null = new zone. */
  zoneId: string | null;
  mode?: EditorMode;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("zones.write");
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
      if (!name) errors["zone.name"] = tr("zone.nameRequired");
      else if (name.length > 80) errors["zone.name"] = tr("zone.nameLong");
      else if (otherNames.includes(name.toLowerCase())) errors["zone.name"] = tr("zone.nameTaken");
      if (d.notes.length > 1000) errors["zone.notes"] = tr("zone.notesLong");
      return { errors };
    },
    [otherNames],
  );
  const editor = useRecordEditor({ source, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, zone?.name ?? "this zone");
  const { menuItem, dialog } = useDeleteZone(() => router.push("/zones"));

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor
      .save(async (d) => {
        const body = { name: d.name.trim(), notes: d.notes.trim() || null };
        try {
          if (isNew) {
            const created = await api.post<ZoneResponse>("/zones", body);
            void revalidate("/zones");
            toast({ title: tr("zone.created"), detail: created.name });
            router.replace(`/zones/${created.id}`);
          } else {
            await api.patch(`/zones/${zoneId}`, body);
            await mutate();
            void revalidate("/zones");
            void revalidate("/devices");
            toast({ title: tr("zone.saved"), detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
          }
        } catch (err) {
          toast({ tone: "error", title: tr("zone.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  if (isNotFound(error)) return <NotFound noun="zone" href="/zones" list="zones" />;
  if (error) {
    return (
      <div className="p-5">
        <ErrorState title={tr("zone.loadFailed")} message={error instanceof ApiRequestError ? error.message : tr("zone.noResponse")} onRetry={() => void mutate()} />
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
        title={d.name.trim() || (isNew ? tr("zone.newZone") : zone!.name)}
        consequence={tr("zone.consequence")}
        sections={[{ id: "zone", label: tr("zone.zone") }]}
        status={editor}
        readOnly={readOnly}
        saveLabel={isNew ? tr("zone.create") : tr("zone.save")}
        onSave={onSave}
        onDiscard={editor.discard}
        menu={
          isNew
            ? undefined
            : [
                [
                  { label: tr("zone.viewDevices"), icon: <Cpu size={15} />, onClick: () => router.push(`/devices?zone=${zoneId}`) },
                  {
                    label: tr("zone.copyLink"),
                    icon: <Link2 size={15} />,
                    onClick: () => void navigator.clipboard.writeText(`${window.location.origin}/zones/${zoneId}`).then(() => toast({ tone: "info", title: tr("zone.linkCopied") })),
                  },
                ],
                ...(readOnly || !zone ? [] : [[menuItem(zone)]]),
              ]
        }
      >
        <EditorSection id="zone" title={tr("zone.zone")}>
          <Field label={tr("zone.name")} error={editor.errorFor("zone.name")}>
            <Input value={d.name} disabled={readOnly} placeholder={tr("zone.namePlaceholder")} onChange={(e) => editor.set({ ...d, name: e.target.value })} onBlur={() => editor.touch("zone.name")} />
          </Field>
          <Field label={tr("zone.notes")} optional error={editor.errorFor("zone.notes")} hint={tr("zone.notesHint")}>
            <Textarea rows={4} value={d.notes} disabled={readOnly} onChange={(e) => editor.set({ ...d, notes: e.target.value })} onBlur={() => editor.touch("zone.notes")} />
          </Field>
          {!isNew && (
            <FactList
              facts={[
                [
                  tr("zone.devices"),
                  devices > 0 ? (
                    <Link key="devices" href={`/devices?zone=${zoneId}`} className="text-accent hover:underline">
                      {tr("zone.deviceCount", { count: devices })}
                    </Link>
                  ) : (
                    tr("zone.noneYet")
                  ),
                ],
              ]}
            />
          )}
        </EditorSection>
      </EditorFrame>
      {dialog}
      {guardDialog}
    </>
  );
}
