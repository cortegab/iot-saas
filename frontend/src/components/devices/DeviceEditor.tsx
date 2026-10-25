"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Cpu, RotateCcw, Trash2, Upload } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { WiringSection } from "@/components/catalog/WiringSection";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import { useDriverCatalog, type DriverSpec } from "@/lib/hardware/driver-catalog";
import {
  blankHardware,
  hardwareToDraft,
  hardwareToRequest,
  validateHardware,
  type HardwareCatalog,
  type HardwareDraft,
  type KeyedRow,
} from "@/lib/hardware/hardware-draft";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";
import { DeviceTopics } from "./DeviceTopics";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

type Rows = { metrics: KeyedRow[]; actuators: KeyedRow[] };

interface DeviceDraft {
  name: string;
  enabled: boolean;
  zoneId: string;
  /** This device's own wiring; null = its template's applies. */
  wiring: HardwareDraft | null;
}

const DIFF: DiffField<DeviceDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Zone", get: (d) => d.zoneId },
  { label: "Rule evaluation", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
  {
    label: "Wiring",
    get: (d) => (d.wiring ? `own: ${d.wiring.inputs.length} in · ${d.wiring.outputs.length} out (${d.wiring.board})` : "the template's"),
  },
];

/** The template's metrics and actuators as rows wiring can point at, keyed
 * by wire id (as the Connect flow keys them). */
function templateRows(template: CatalogEntryResponse | undefined): Rows {
  return {
    metrics: (template?.metrics ?? []).map((m) => ({ uid: wireId(m), key: wireId(m), name: m.name, type: m.data_type ?? "float" })),
    actuators: (template?.actuators ?? []).map((a) => ({ uid: wireId(a), key: wireId(a), name: a.name, type: a.value_type ?? "bool" })),
  };
}

function validate(d: DeviceDraft, rows: Rows, catalog: HardwareCatalog | undefined): Validation {
  const errors: Record<string, string> = {};
  if (!d.name.trim()) errors["identity.name"] = "Give the device a name.";
  else if (d.name.trim().length > 100) errors["identity.name"] = "Keep the name under 100 characters.";
  const wiring = validateHardware(d.wiring, rows, catalog);
  return { errors: { ...errors, ...wiring.errors }, warnings: wiring.warnings };
}

const wiringBody = (w: HardwareDraft | null, rows: Rows, drivers: DriverSpec[] | undefined) => JSON.stringify(hardwareToRequest(w, rows, drivers));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const KV = "grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13.5px] text-ink max-sm:grid-cols-1 max-sm:gap-y-1 max-sm:[&_dd]:mb-2";

/** Edit a device's name, zone and rule evaluation (DESIGN.md §7/§8). It
 * lives in the device page's Settings tab (`embedded`: the page has the
 * title and record menu); the devices list only peeks. */
export function DeviceEditor({
  deviceId,
  embedded = false,
  onRotate,
  onDelete,
}: {
  deviceId: string;
  embedded?: boolean;
  /** The record actions (useDeviceActions), so they confirm as the ⋯ menu does. */
  onRotate?: () => void;
  onDelete?: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("devices.write");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: device, error, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: template, mutate: mutateTemplate } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const zoneName = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);
  const { data: catalog } = useDriverCatalog();
  const rows = useMemo(() => templateRows(template), [template]);
  const templateWiring = useMemo(() => hardwareToDraft(template?.hardware, rows), [template, rows]);

  // Waits for the template too: the wiring's channels point at its rows.
  const source = useMemo<DeviceDraft | null>(
    () =>
      device && template
        ? {
            name: device.name,
            enabled: device.status === "active",
            zoneId: device.zone_id ?? "",
            wiring: hardwareToDraft(device.hardware, rows),
          }
        : null,
    [device, template, rows],
  );
  const check = useCallback((d: DeviceDraft) => validate(d, rows, catalog), [rows, catalog]);
  const editor = useRecordEditor({ source, validate: check });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, device ? device.name : "this device");

  const ruleCount = useMemo(
    () => (rules ?? []).filter((r) => r.devices.some((d) => d.device_id === deviceId)).length,
    [rules, deviceId],
  );

  async function copyUsername() {
    try {
      await navigator.clipboard.writeText(deviceId);
      toast({ tone: "info", title: "Username copied" });
    } catch {
      toast({ tone: "error", title: "Couldn't copy", detail: "Select the username and copy it yourself." });
    }
  }

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor.save(async (d) => {
      const body: Record<string, unknown> = {};
      if (d.name.trim() !== device?.name) body.name = d.name.trim();
      if (d.enabled !== (device?.status === "active")) body.status = d.enabled ? "active" : "disabled";
      if (d.zoneId !== (device?.zone_id ?? "")) body.zone_id = d.zoneId || null;
      const wiring = wiringBody(d.wiring, rows, catalog?.drivers);
      if (wiring !== wiringBody(before?.wiring ?? null, rows, catalog?.drivers)) body.hardware = JSON.parse(wiring) as unknown;
      try {
        await api.patch(`/devices/${deviceId}`, body);
      } catch (err) {
        toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
        throw err;
      }
      await mutate();
      const named = (x: DeviceDraft) => ({ ...x, zoneId: x.zoneId ? (zoneName.get(x.zoneId) ?? "") : "" });
      toast({ title: "Device saved", detail: before ? changeSummary(diffLines(named(before), named(d), DIFF)) : undefined });
    }).catch(() => false);
  }

  /** Make this device's saved wiring the template's, and put the device back
   * on it: the other devices that follow the template get it on their next Install. */
  async function saveWiringToTemplate() {
    if (!device?.hardware || !template) return;
    const others = template.device_count - 1;
    const ok = await confirm(
      <p>
        {template.hardware ? "This replaces the template's wiring. " : ""}
        {others > 0 ? (
          <>
            The other <strong>{plural(others, "device")}</strong> of {template.name} that use the template&apos;s wiring get this wiring on
            their next Install. Devices with their own wiring keep it.
          </>
        ) : (
          <>New devices of {template.name} start with this wiring.</>
        )}
      </p>,
      { title: `Save this wiring to ${template.name}?`, confirmLabel: "Save to template" },
    );
    if (!ok) return;
    try {
      await api.patch(`/catalog/${template.id}`, { hardware: device.hardware as unknown as Record<string, unknown> });
      await api.patch(`/devices/${device.id}`, { hardware: null });
      await Promise.all([mutate(), mutateTemplate()]);
      toast({ title: "Wiring saved to the template", detail: `${device.name} now uses the ${template.name} wiring.` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't save the wiring to the template", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState
          title="Couldn't load this device"
          message={error instanceof ApiRequestError ? error.message : "The API didn't respond."}
          onRetry={() => void mutate()}
        />
      </div>
    );
  }
  if (!device || !editor.draft) {
    return (
      <div className="p-5">
        <LoadingSkeleton rows={4} rowClassName="h-10" />
      </div>
    );
  }

  const d = editor.draft;
  const consequence = d.enabled
    ? "Saving applies right away. Renaming keeps its MQTT id, so the device doesn't need a new install."
    : `Saving stops rule evaluation for this device and refuses its connections. ${ruleCount ? `${plural(ruleCount, "rule")} stop evaluating it. ` : ""}Its history is kept.`;
  // Plain stacked sections, no boxes (demo H device Settings).
  const card = false;

  return (
    <>
      <EditorFrame
        mode="page"
        headless={embedded}
        noun="device"
        title={d.name.trim() || device.name}
        eyebrow={
          <>
            Device <DeviceStatusPill device={device} />
          </>
        }
        consequence={consequence}
        sections={[
          { id: "general", label: "General", description: "Name and zone" },
          { id: "status", label: "Rule evaluation", description: "Whether rules evaluate it" },
          { id: "hardware", label: "Wiring", description: d.wiring ? "This device's own" : "The template's" },
        ]}
        sectionOf={(p) => (p.startsWith("identity") ? "general" : p.split(".")[0])}
        status={editor}
        readOnly={readOnly}
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <div className="flex max-w-[760px] flex-col gap-7 [&>section+section]:border-t [&>section+section]:border-border-soft [&>section+section]:pt-7">
        {embedded && <p className="max-w-[70ch] text-[14px] text-ink-muted">{consequence}</p>}

        <EditorSection id="general" title="General" card={card}>
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={editor.errorFor("identity.name")} hint="Shown in lists, dashboards and alerts.">
            <Input
              value={d.name}
              disabled={readOnly}
              onChange={(e) => editor.set({ ...d, name: e.target.value })}
              onBlur={() => editor.touch("identity.name")}
            />
          </Field>
          <Field
            label="Zone"
            optional
            hint={
              <>
                Where it&apos;s installed.{" "}
                <Link href="/zones" className="text-accent hover:underline">
                  Manage zones
                </Link>
              </>
            }
          >
            <Select value={d.zoneId} disabled={readOnly} onChange={(e) => editor.set({ ...d, zoneId: e.target.value })}>
              <option value="">No zone</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
          </div>
        </EditorSection>

        <EditorSection id="status" title="Rule evaluation" card={card} lead={ruleCount ? `${plural(ruleCount, "rule")} use${ruleCount === 1 ? "s" : ""} this device.` : "No rules use this device yet."}>
          <SwitchField
            label="Status"
            checked={d.enabled}
            disabled={readOnly}
            onChange={(enabled) => editor.set({ ...d, enabled })}
            onLabel="Enabled"
            offLabel="Disabled"
            onHint="Rules evaluate its readings and it can connect."
            offHint="Rules ignore it and its connections are refused. Telemetry history is kept."
          />
        </EditorSection>

        <EditorSection id="template" title="Template" card={card} lead="A device keeps the template it was added with.">
          {template ? (
            <dl className={KV}>
              <dt className="text-ink-muted">Template</dt>
              <dd className="m-0">
                <Link href={`/templates/${template.id}`} className="text-accent hover:underline">
                  {template.name}
                </Link>
                <span className="text-ink-muted"> · {template.runs_on === "generic_firmware" ? "Our firmware" : "Custom firmware"}</span>
              </dd>
              <dt className="text-ink-muted">Wiring</dt>
              <dd className="m-0">{d.wiring ? "Its own (overrides the template's)" : template.hardware ? "The template's" : "None: it runs a sketch"}</dd>
              <dt className="text-ink-muted">Gives it</dt>
              <dd className="m-0">
                {[
                  template.metrics.length ? `Metrics: ${template.metrics.map((m) => m.name).join(", ")}` : null,
                  template.actuators.length ? `Actuators: ${template.actuators.map((a) => a.name).join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No metrics or actuators"}
              </dd>
            </dl>
          ) : (
            <LoadingSkeleton rows={2} rowClassName="h-5" />
          )}
        </EditorSection>

        {template && d.wiring && (
          <WiringSection
            card={card}
            lead="This device is wired its own way. Template edits to the wiring don't reach it; its metrics and actuators still come from the template."
            hardware={d.wiring}
            rows={rows}
            readOnly={readOnly}
            onChange={(wiring) => editor.set({ ...d, wiring })}
            field={(path) => ({ error: editor.errorFor(path), warning: editor.warningFor(path), onBlur: () => editor.touch(path) })}
          >
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => editor.set({ ...d, wiring: null })}>
                  <RotateCcw aria-hidden size={14} />
                  Use the template&apos;s wiring
                </Button>
                {device.hardware && !editor.dirty && (
                  <Button variant="secondary" onClick={() => void saveWiringToTemplate()}>
                    <Upload aria-hidden size={14} />
                    Save to {template.name}…
                  </Button>
                )}
              </div>
            )}
          </WiringSection>
        )}

        {template && !d.wiring && (
          <WiringSection
            card={card}
            lead="How this board is wired, for installing from the browser. It follows the template unless this one is built differently: another board, a moved pin, a different sensor."
            hardware={templateWiring ?? undefined}
            rows={rows}
            readOnly
          >
            {!templateWiring && (
              <Callout>
                {template.name} has no wiring, so this device gets a sketch to edit and upload. Wire this device alone, or{" "}
                <Link href={`/templates/${template.id}#hardware`} className="text-accent hover:underline">
                  set up the template&apos;s wiring
                </Link>{" "}
                for every device of it.
              </Callout>
            )}
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={!catalog && !template.hardware}
                  // A fresh copy: its own row ids, apart from the read-only view's.
                  onClick={() => editor.set({ ...d, wiring: hardwareToDraft(template.hardware, rows) ?? blankHardware(catalog?.models[0]?.id) })}
                >
                  <Cpu aria-hidden size={14} />
                  Wire this device differently
                </Button>
                {template.hardware && (
                  <Link href={`/templates/${template.id}#hardware`} className={buttonClassName({ variant: "secondary" })}>
                    Edit the template&apos;s wiring
                  </Link>
                )}
              </div>
            )}
          </WiringSection>
        )}

        {embedded && (
          <EditorSection id="connection" title="Connection" card={card}>
            <dl className={KV}>
              <dt className="text-ink-muted">MQTT username</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="break-all font-mono text-[13px] text-ink">{device.id}</span>
                <Button variant="link" className="text-[13px]" onClick={() => void copyUsername()}>
                  Copy
                </Button>
              </dd>
              <dt className="text-ink-muted">Password</dt>
              <dd className="m-0 flex flex-wrap items-center gap-x-2">
                <span>Shown once when created, stored hashed.</span>
                {!readOnly && onRotate && (
                  <Button variant="link" className="text-[13px]" onClick={onRotate}>
                    Rotate credential…
                  </Button>
                )}
              </dd>
              <dt className="text-ink-muted">Topics</dt>
              <dd className="m-0 min-w-0">
                <details className="group">
                  <summary className="cursor-pointer text-accent hover:underline">Show its MQTT topics</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <DeviceTopics device={device} template={template} />
                  </div>
                </details>
              </dd>
            </dl>
          </EditorSection>
        )}

        {embedded && !readOnly && onDelete && (
          <EditorSection id="danger" title="Delete" card={card} tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
                Deletes its credential and history. {ruleCount ? `${plural(ruleCount, "rule")} and any widgets that use it stop working.` : "Widgets that use it stop working."}
              </p>
              <Button variant="secondary" className="text-status-error" onClick={onDelete}>
                <Trash2 aria-hidden size={14} />
                Delete device…
              </Button>
            </div>
          </EditorSection>
        )}
        </div>
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
