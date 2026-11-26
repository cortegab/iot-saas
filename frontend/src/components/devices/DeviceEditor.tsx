"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { FactList } from "@/components/ui/FactList";
import { Inherited } from "@/components/ui/Inherited";
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
import { DeviceLabel } from "@/components/devices/DeviceLabel";
import { templateGivesFacts } from "@/components/catalog/template-facts";
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
import { FirmwareSection } from "@/components/devices/FirmwareSection";
import { DeviceTopics } from "./DeviceTopics";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

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
  { get label() { return tr("setup.diff.name"); }, get: (d) => d.name.trim() },
  { get label() { return tr("setup.diff.zone"); }, get: (d) => d.zoneId },
  { get label() { return tr("setup.diff.status"); }, get: (d) => d.enabled, format: (v) => (v ? tr("setup.enabled") : tr("setup.disabled")) },
  {
    get label() { return tr("setup.diff.wiring"); },
    get: (d) => (d.wiring ? tr("setup.diff.own", { inputs: d.wiring.inputs.length, outputs: d.wiring.outputs.length, board: d.wiring.board }) : tr("setup.diff.templates")),
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
  if (!d.name.trim()) errors["identity.name"] = tr("setup.nameRequired");
  else if (d.name.trim().length > 100) errors["identity.name"] = tr("setup.nameLong");
  const wiring = validateHardware(d.wiring, rows, catalog);
  return { errors: { ...errors, ...wiring.errors }, warnings: wiring.warnings };
}

const wiringBody = (w: HardwareDraft | null, rows: Rows, drivers: DriverSpec[] | undefined) => JSON.stringify(hardwareToRequest(w, rows, drivers));


/** Edit a device's name, zone and rule evaluation (DESIGN.md §7/§8). It
 * lives in the device page's Settings tab (`embedded`: the page has the
 * title and record menu); the devices list only peeks. */
export function DeviceEditor({
  deviceId,
  embedded = false,
  onRotate,
}: {
  deviceId: string;
  embedded?: boolean;
  /** The record actions (useDeviceActions), so they confirm as the ⋯ menu does. */
  onRotate?: () => void;
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
  const rulesLine = ruleCount ? tr("setup.rulesUse", { count: ruleCount }) : tr("setup.noRulesUse");

  async function copyUsername() {
    try {
      await navigator.clipboard.writeText(deviceId);
      toast({ tone: "info", title: tr("setup.usernameCopied") });
    } catch {
      toast({ tone: "error", title: tr("setup.copyFailed"), detail: tr("setup.copyFailedDetail") });
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
        toast({ tone: "error", title: tr("settings.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
        throw err;
      }
      await mutate();
      const named = (x: DeviceDraft) => ({ ...x, zoneId: x.zoneId ? (zoneName.get(x.zoneId) ?? "") : "" });
      toast({ title: tr("setup.saved"), detail: before ? changeSummary(diffLines(named(before), named(d), DIFF)) : undefined });
    }).catch(() => false);
  }

  /** Make this device's saved wiring the template's, and put the device back
   * on it: the other devices that follow the template get it on their next Install. */
  async function saveWiringToTemplate() {
    if (!device?.hardware || !template) return;
    const others = template.device_count - 1;
    const ok = await confirm(
      <p>
        {template.hardware ? `${tr("setup.replacesWiring")} ` : ""}
        {others > 0 ? (
          <>{richT(tr, "setup.othersGet", { devices: <strong>{tr("setup.othersCount", { count: others })}</strong> }, { template: template.name })}</>
        ) : (
          <>{tr("setup.newStart", { template: template.name })}</>
        )}
      </p>,
      { title: tr("setup.saveWiringTitle", { template: template.name }), confirmLabel: tr("setup.saveWiringConfirm") },
    );
    if (!ok) return;
    try {
      await api.patch(`/catalog/${template.id}`, { hardware: device.hardware as unknown as Record<string, unknown> });
      await api.patch(`/devices/${device.id}`, { hardware: null });
      await Promise.all([mutate(), mutateTemplate()]);
      toast({ title: tr("setup.wiringSaved"), detail: tr("setup.wiringSavedDetail", { device: device.name, template: template.name }) });
    } catch (err) {
      toast({ tone: "error", title: tr("setup.wiringFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  if (error) {
    return (
      <div className="p-5">
        <ErrorState
          title={tr("setup.loadFailed")}
          message={error instanceof ApiRequestError ? error.message : tr("devices.apiDown")}
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
    ? tr("setup.consequenceOn")
    : tr("setup.consequenceOff", { rules: ruleCount ? tr("setup.rulesStop", { count: ruleCount }) : "" });
  // Plain stacked sections, no boxes (demo H device Settings).

  return (
    <>
      <EditorFrame
        mode="page"
        headless={embedded}
        noun={tr("setup.noun")}
        title={d.name.trim() || device.name}
        eyebrow={
          <>
            Device <DeviceStatusPill device={device} />
          </>
        }
        consequence={consequence}
        sections={[
          { id: "general", label: tr("setup.sections.general"), description: tr("setup.sections.generalHint") },
          { id: "hardware", label: tr("setup.sections.wiring"), description: d.wiring ? tr("setup.sections.ownWiring") : tr("setup.sections.templatesWiring") },
        ]}
        sectionOf={(p) => (p.startsWith("identity") ? "general" : p.split(".")[0])}
        status={editor}
        readOnly={readOnly}
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <div className="flex flex-col gap-7">
        {embedded && <p className="max-w-[70ch] text-sm text-ink-muted">{consequence}</p>}

        <EditorSection id="general" title={tr("setup.sections.general")}>
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("setup.name")} error={editor.errorFor("identity.name")} hint={tr("setup.nameHint")}>
            <Input
              value={d.name}
              disabled={readOnly}
              onChange={(e) => editor.set({ ...d, name: e.target.value })}
              onBlur={() => editor.touch("identity.name")}
            />
          </Field>
          <Field
            label={tr("setup.zone")}
            optional
            hint={
              <>
                Where it&apos;s installed.{" "}
                <Link href="/zones" className="link-inline">
                  {tr("setup.manageZones")}
                </Link>
              </>
            }
          >
            <Select value={d.zoneId} disabled={readOnly} onChange={(e) => editor.set({ ...d, zoneId: e.target.value })}>
              <option value="">{tr("setup.noZone")}</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
          </div>
          <SwitchField
            label={tr("setup.status")}
            checked={d.enabled}
            disabled={readOnly}
            onChange={(enabled) => editor.set({ ...d, enabled })}
            onLabel={tr("setup.enabled")}
            offLabel={tr("setup.disabled")}
            onHint={tr("setup.statusOn", { rules: rulesLine })}
            offHint={tr("setup.statusOff", { rules: rulesLine })}
          />
        </EditorSection>

        <EditorSection id="template" title={tr("setup.sections.template")} lead={tr("setup.templateLead")}>
          {template ? (
            <FactList
              facts={[
                [
                  tr("setup.template"),
                  <>
                    <Link href={`/templates/${template.id}`} className="link-inline">
                      {template.name}
                    </Link>
                    <span className="text-ink-muted"> · {template.runs_on === "generic_firmware" ? tr("setup.ourFirmware") : tr("setup.customFirmware")}</span>
                  </>,
                ],
                ...templateGivesFacts(template),
              ]}
            />
          ) : (
            <LoadingSkeleton rows={2} rowClassName="h-5" />
          )}
        </EditorSection>

        {template && (
          <WiringSection
            lead={tr("setup.wiringLead")}
            showYield={false}
            header={
              <Inherited
                from="the template"
                what="wiring"
                overridden={!!d.wiring}
                readOnly={readOnly}
                overrideLabel={tr("setup.wireDifferently")}
                resetLabel={tr("setup.useTemplateWiring")}
                // A fresh copy: its own row ids, apart from the read-only view's.
                onOverride={() => editor.set({ ...d, wiring: hardwareToDraft(template.hardware, rows) ?? blankHardware(catalog?.models[0]?.id) })}
                onReset={() => editor.set({ ...d, wiring: null })}
                disabled={!d.wiring && !catalog && !template.hardware}
                note={
                  d.wiring
                    ? tr("setup.ownNote")
                    : tr("setup.templateNote")
                }
                actions={
                  d.wiring ? (
                    device.hardware &&
                    !editor.dirty && (
                      <Button variant="secondary" size="sm" onClick={() => void saveWiringToTemplate()}>
                        {tr("setup.saveTo", { template: template.name })}
                      </Button>
                    )
                  ) : (
                    template.hardware && (
                      <Link href={`/templates/${template.id}#hardware`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                        {tr("setup.editTemplateWiring")}
                      </Link>
                    )
                  )
                }
              />
            }
            hardware={d.wiring ?? templateWiring ?? undefined}
            rows={rows}
            readOnly={readOnly || !d.wiring}
            onChange={(wiring) => editor.set({ ...d, wiring })}
            field={d.wiring ? (path) => ({ error: editor.errorFor(path), warning: editor.warningFor(path), onBlur: () => editor.touch(path) }) : undefined}
          >
            {!d.wiring && !templateWiring && (
              <Callout>
                {richT(tr, "setup.noWiring", {
                  link: (
                    <Link href={`/templates/${template.id}#hardware`} className="link-inline">
                      {tr("setup.setUpWiring")}
                    </Link>
                  ),
                }, { template: template.name })}
              </Callout>
            )}
          </WiringSection>
        )}

        {embedded && (
          <EditorSection id="connection" title={tr("setup.sections.connection")}>
            <FactList
              facts={[
                [
                  tr("setup.mqttUsername"),
                  <span key="username" className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="break-all font-mono text-meta">{device.id}</span>
                    <Button variant="link" className="text-meta" onClick={() => void copyUsername()}>
                      {tr("setup.copy")}
                    </Button>
                  </span>,
                ],
                [
                  tr("setup.password"),
                  <span key="password" className="flex flex-wrap items-center gap-x-2">
                    <span>{tr("setup.shownOnce")}</span>
                    {!readOnly && onRotate && (
                      <Button variant="link" className="text-meta" onClick={onRotate}>
                        {tr("setup.rotate")}
                      </Button>
                    )}
                  </span>,
                ],
                [tr("setup.label"), <DeviceLabel key="label" device={device} />],
                [
                  tr("setup.topics"),
                  <details key="topics" className="group">
                    <summary className="cursor-pointer text-accent hover:underline">{tr("setup.showTopics")}</summary>
                    <div className="mt-2 flex flex-col gap-2">
                      <DeviceTopics device={device} template={template} />
                    </div>
                  </details>,
                ],
              ]}
            />
          </EditorSection>
        )}

        {embedded && (template?.runs_on === "generic_firmware" || device.hardware != null) && (
          <EditorSection id="firmware" title={tr("setup.sections.firmware")} lead={tr("setup.firmwareLead")}>
            <FirmwareSection deviceId={device.id} readOnly={readOnly} />
          </EditorSection>
        )}

        </div>
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
