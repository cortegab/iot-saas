"use client";

import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Copy, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { WiringSection } from "@/components/catalog/WiringSection";
import { ActuatorsSection } from "@/components/catalog/template/ActuatorsSection";
import { GeneralSection } from "@/components/catalog/template/GeneralSection";
import { MetricsSection } from "@/components/catalog/template/MetricsSection";
import type { Draft, SectionProps } from "@/components/catalog/template/section-props";
import { EditorFrame, type EditorMode, type EditorSectionDef } from "@/components/editor/EditorFrame";
import { useRecordEditor } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import { handOffCredential } from "@/lib/credential-handoff";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { blankHardware } from "@/lib/hardware/hardware-draft";
import {
  blankTemplate,
  brokenUsages,
  draftToRequest,
  keepReading,
  keyedRows,
  reconcileParts,
  renamed,
  templateSectionOrder,
  templateToDraft,
  validateTemplate,
  type RunsOn,
  type TemplateDraft,
  type TemplateSectionId,
} from "@/lib/template-draft";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogUsageResponse = components["schemas"]["CatalogUsageResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DIFF: DiffField<TemplateDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Status", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
  { label: "Runs on", get: (d) => d.runsOn, format: (v) => (v === "generic_firmware" ? "Our firmware" : "Own code or a gateway") },
  { label: "Metrics", get: (d) => d.metrics.map((m) => m.key.trim()) },
  { label: "Actuators", get: (d) => d.actuators.map((a) => a.key.trim()) },
  {
    label: "Wiring",
    get: (d) => (d.hardware ? `${d.hardware.inputs.length} in · ${d.hardware.outputs.length} out (${d.hardware.board})` : "none"),
  },
];

/** The rail entry for a section, worded for how the devices run. */
function railEntry(id: TemplateSectionId, d: Draft): EditorSectionDef {
  const parts = d.runsOn === "generic_firmware";
  switch (id) {
    case "general":
      return { id, label: "General", description: d.device ? "The device, and how it runs" : "Name, how it runs, availability" };
    case "hardware":
      return { id, label: "Wiring", description: "The board and its parts" };
    case "metrics":
      return { id, label: "Metrics", count: d.metrics.length, description: parts ? "What its parts read" : "What the device publishes" };
    case "actuators":
      return { id, label: "Actuators", count: d.actuators.length, description: parts ? "What its parts switch" : "What the platform can switch" };
  }
}

/**
 * The device-template editor (DESIGN.md §8) on the shared editor chrome:
 * General · Wiring · Metrics · Actuators, each its own component (template/,
 * WiringSection), in the order templateSectionOrder gives for how the
 * devices run (`runsOn`): own code has no Wiring. Keys follow the name until
 * edited, used keys are locked (with a rename warning when unlocked), every
 * key shows its MQTT topic, and saving a change that disconnects rules or
 * widgets asks first.
 *
 * `onboard`: adding something new (/devices/new?from=new). The same editor,
 * with the device's name and zone on top; on our firmware its parts bring
 * their metrics and actuators (reconcileParts). Saving creates the template
 * and the device in one call.
 */
export function TemplateEditor({
  entryId,
  duplicateOf,
  mode = "page",
  onboard = false,
  runsOn = "generic_firmware",
}: {
  /** null = new template. */
  entryId: string | null;
  duplicateOf?: string | null;
  mode?: EditorMode;
  onboard?: boolean;
  /** How a new template's (or onboarded device's) devices run, to start with. */
  runsOn?: RunsOn;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("templates.write");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: entry, error, mutate } = useApiSWR<CatalogEntryResponse>(entryId ? `/catalog/${entryId}` : null);
  const { data: source } = useApiSWR<CatalogEntryResponse>(duplicateOf ? `/catalog/${duplicateOf}` : null);
  const { data: all } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: usage } = useApiSWR<CatalogUsageResponse>(entryId ? `/catalog/${entryId}/usage` : null);
  const { data: catalog, isLoading: catalogLoading } = useDriverCatalog();
  const drivers = catalog?.drivers;
  const { data: zones } = useApiSWR<ZoneResponse[]>(onboard ? "/zones" : null);

  const isNew = entryId == null;
  const initial = useMemo<Draft | null>(() => {
    if (onboard) {
      const device = { name: "", zoneId: "", templateNameAuto: true };
      // Our firmware starts at the board, ready for its first part.
      return { ...blankTemplate(runsOn), hardware: runsOn === "generic_firmware" ? blankHardware() : null, device };
    }
    if (!isNew) return entry ? templateToDraft(entry) : null;
    if (duplicateOf) return source ? templateToDraft(source, { duplicate: true }) : null;
    return blankTemplate(runsOn);
  }, [onboard, runsOn, isNew, entry, duplicateOf, source]);

  const otherNames = useMemo(() => (all ?? []).filter((e) => e.id !== entryId).map((e) => e.name), [all, entryId]);
  const validate = useCallback(
    (d: Draft) => {
      // Own code keeps no wiring: what's left in the draft is dropped on save.
      const v = validateTemplate(d.runsOn === "own_code" ? { ...d, hardware: null } : d, { otherNames, usage, catalog });
      if (!d.device) return v;
      const name = d.device.name.trim();
      const deviceError = !name ? "Give the device a name." : name.length > 100 ? "Keep the name under 100 characters." : null;
      return deviceError ? { ...v, errors: { ...v.errors, "general.device": deviceError } } : v;
    },
    [otherNames, usage, catalog],
  );
  const editor = useRecordEditor<Draft>({ source: initial, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, onboard ? "this device" : (entry?.name ?? "this template"));

  if (error) {
    return (
      <div className="p-5">
        <ErrorState
          title="Couldn't load this template"
          message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
          onRetry={() => void mutate()}
        />
      </div>
    );
  }
  const d = editor.draft;
  if (!d) {
    return (
      <div className="p-5">
        <LoadingSkeleton rows={5} rowClassName="h-10" />
      </div>
    );
  }

  const set = (next: Draft) => editor.set(next);
  const f = (path: string) => ({ error: editor.errorFor(path), warning: editor.warningFor(path) });
  const blur = (path: string) => () => editor.touch(path);
  const props: SectionProps = { d, set, editor, f, blur, readOnly, mode, usage };

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    const broken = brokenUsages(d!, editor.original, usage);
    if (broken.length && Object.keys(editor.errors).length === 0) {
      const ok = await confirm("Rules and widgets that use these keys stop receiving data. Existing telemetry stays under the old keys.", {
        title: "Save changes that disconnect keys?",
        confirmLabel: "Save anyway",
        details: (
          <ul>
            {broken.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ),
      });
      if (!ok) return true;
    }
    return editor
      .save(async (draft) => {
        const body = draftToRequest(draft, drivers);
        const parts = {
          runs_on: body.runs_on,
          metrics: body.metrics as unknown as Record<string, unknown>[],
          actuators: body.actuators as unknown as Record<string, unknown>[],
          hardware: body.hardware as unknown as Record<string, unknown> | null,
        };
        try {
          if (draft.device) {
            const result = await api.post<DeviceCreateResponse>("/devices", {
              name: draft.device.name.trim(),
              ...(draft.device.zoneId ? { zone_id: draft.device.zoneId } : {}),
              new_template: { name: body.name, ...parts },
            });
            void revalidate("/devices");
            void revalidate("/catalog");
            handOffCredential(result.device.id, result.credential);
            router.push(`/devices/${result.device.id}/connect`);
          } else if (isNew) {
            const created = await api.post<CatalogEntryResponse>("/catalog", { name: body.name, ...parts });
            if (!draft.enabled) await api.patch(`/catalog/${created.id}`, { status: "disabled" });
            void revalidate("/catalog");
            toast({ title: "Template created", detail: `${created.name} is ${draft.enabled ? "available in Add device" : "disabled"}.` });
            router.replace(`/templates/${created.id}`);
          } else {
            await api.patch(`/catalog/${entryId}`, { ...body, ...parts });
            await mutate();
            toast({ title: "Template saved", detail: before ? changeSummary(diffLines(before, draft, DIFF)) : undefined });
          }
        } catch (err) {
          toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function remove() {
    if (!entry) return;
    if (entry.device_count > 0) {
      await confirm(`${plural(entry.device_count, "device uses", "devices use")} this template, so it can't be deleted. Move or delete them first, or disable the template.`, {
        title: `${entry.name} is in use`,
        confirmLabel: "OK",
        cancelLabel: "Close",
        danger: false,
      });
      return;
    }
    if (!(await confirm("No devices use it. This can't be undone.", { title: `Delete ${entry.name}?`, confirmLabel: "Delete template" }))) return;
    try {
      await api.delete(`/catalog/${entry.id}`);
      void revalidate("/catalog");
      toast({ title: `${entry.name} deleted` });
      router.push("/templates");
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the template", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const devices = entry?.device_count ?? 0;
  const consequence = d.device
    ? "Creating it makes the device and its template together; next comes its credential and Install."
    : isNew
    ? d.enabled
      ? "Creating it makes it available in Add device."
      : "It's created disabled, so it won't be offered in Add device yet."
    : devices
      ? `Saving updates ${plural(devices, "device")} and re-sends their telemetry profile within seconds.`
      : "No devices use it yet.";

  // A reading's metric (or a command's actuator), renamed on its part card.
  const renameTarget = (kind: "inputs" | "outputs", uid: string, name: string) =>
    kind === "inputs"
      ? set({ ...d, metrics: d.metrics.map((m) => (m.uid === uid ? renamed(m, name) : m)) })
      : set({ ...d, actuators: d.actuators.map((a) => (a.uid === uid ? renamed(a, name) : a)) });
  // Its key's problem (clash, reserved, invalid), shown on the part card too.
  const targetError = (kind: "inputs" | "outputs", uid: string) => {
    const rows = kind === "inputs" ? d.metrics : d.actuators;
    const i = rows.findIndex((r) => r.uid === uid);
    return i >= 0 && rows[i].key.trim() ? editor.errors[`${kind === "inputs" ? "metrics" : "actuators"}.${i}.key`] : undefined;
  };

  // Adding a part brings its metrics and actuators (reconcileParts).
  const wiring = (
    <WiringSection
      lead="Pick the board, then add each part. Every part brings its metrics or actuators: name them on the part, and fine-tune them below."
      hardware={d.hardware}
      rows={keyedRows(d)}
      readOnly={readOnly}
      onChange={(hardware) => set({ ...reconcileParts(d, hardware, catalog), device: d.device })}
      field={(path) => ({ ...f(path), onBlur: blur(path) })}
      onRenameTarget={renameTarget}
      targetError={targetError}
      onKeepReading={(bindingUid, channel, keep) => set({ ...keepReading(d, bindingUid, channel, keep, catalog), device: d.device })}
    >
      {!catalogLoading && !catalog && (
        <p className="text-sm text-ink-muted">
          No firmware release is published yet, so there&apos;s nothing to wire. Choose <b className="text-ink">My own code or a gateway</b> under
          Runs on to list the device&apos;s data instead.
        </p>
      )}
    </WiringSection>
  );
  const body: Record<TemplateSectionId, ReactNode> = {
    general: <GeneralSection {...props} zones={zones} />,
    hardware: wiring,
    metrics: <MetricsSection {...props} />,
    actuators: <ActuatorsSection {...props} />,
  };
  const order = templateSectionOrder({ runsOn: d.runsOn });

  return (
    <>
      <EditorFrame
        mode={mode}
        noun={d.device ? "device" : "device template"}
        title={d.device ? d.device.name.trim() || "New device" : isNew ? d.name.trim() || "New device template" : d.name.trim() || entry!.name}
        eyebrow={
          <>
            {d.device ? "New device" : "Device template"}
            {!isNew && (d.enabled ? <Badge tone="online" label="Enabled" /> : <Badge tone="unknown" shape="square" label="Disabled" />)}
            {!isNew && <span>· {plural(devices, "device")}</span>}
          </>
        }
        consequence={consequence}
        sections={order.map((id) => railEntry(id, d))}
        status={editor}
        readOnly={readOnly}
        saveLabel={d.device ? "Create device" : isNew ? "Create template" : "Save"}
        onSave={onSave}
        onDiscard={editor.discard}
        headerActions={
          !isNew && !readOnly ? (
            <Button variant="secondary" size="sm" className="max-md:hidden" onClick={() => router.push(`/templates/new?duplicate=${entryId}`)}>
              <Copy aria-hidden size={14} />
              Duplicate
            </Button>
          ) : undefined
        }
        menu={!isNew && !readOnly ? [[{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }]] : undefined}
      >
        {order.map((id) => (
          <Fragment key={id}>{body[id]}</Fragment>
        ))}
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
