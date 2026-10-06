"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cpu, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Tag } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/SecretReveal";
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
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";
import { DeviceTopics } from "./DeviceTopics";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

interface DeviceDraft {
  name: string;
  enabled: boolean;
  zoneId: string;
}

const DIFF: DiffField<DeviceDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Zone", get: (d) => d.zoneId },
  { label: "Rule evaluation", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
];

function validate(d: DeviceDraft): Validation {
  const errors: Record<string, string> = {};
  if (!d.name.trim()) errors["identity.name"] = "Give the device a name.";
  else if (d.name.trim().length > 100) errors["identity.name"] = "Keep the name under 100 characters.";
  return { errors };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Edit a device's name, zone and rule evaluation (DESIGN.md §7/§8). It
 * lives in the device page's Settings tab (`embedded`: the page has the
 * title and record menu); the devices list only peeks. */
export function DeviceEditor({ deviceId, embedded = false }: { deviceId: string; embedded?: boolean }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("devices.write");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: device, error, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  const zoneName = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);

  const source = useMemo<DeviceDraft | null>(
    () => (device ? { name: device.name, enabled: device.status === "active", zoneId: device.zone_id ?? "" } : null),
    [device],
  );
  const editor = useRecordEditor({ source, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, device ? device.name : "this device");

  const ruleCount = useMemo(
    () => (rules ?? []).filter((r) => r.devices.some((d) => d.device_id === deviceId)).length,
    [rules, deviceId],
  );

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor.save(async (d) => {
      const body: Record<string, unknown> = {};
      if (d.name.trim() !== device?.name) body.name = d.name.trim();
      if (d.enabled !== (device?.status === "active")) body.status = d.enabled ? "active" : "disabled";
      if (d.zoneId !== (device?.zone_id ?? "")) body.zone_id = d.zoneId || null;
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

  async function remove() {
    if (!device) return;
    const ok = await confirm(
      <p>
        Its credential stops working immediately
        {ruleCount > 0 && (
          <>
            , <strong>{plural(ruleCount, "rule")}</strong> stop evaluating it
          </>
        )}
        , and its telemetry history is removed. This can&apos;t be undone.
      </p>,
      { title: `Delete ${device.name}?`, confirmLabel: "Delete device" },
    );
    if (!ok) return;
    try {
      await api.delete(`/devices/${device.id}`);
      toast({ title: `${device.name} deleted` });
      router.push("/devices");
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the device", detail: err instanceof ApiRequestError ? err.message : undefined });
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
    ? `Saving applies immediately.${ruleCount ? ` ${plural(ruleCount, "rule")} use${ruleCount === 1 ? "s" : ""} this device.` : ""}`
    : `Saving stops rule evaluation for this device and refuses its connections. ${ruleCount ? `${plural(ruleCount, "rule")} stop evaluating it. ` : ""}Its history is kept.`;
  const card = embedded;

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
        ]}
        sectionOf={(p) => (p.startsWith("identity") ? "general" : p.split(".")[0])}
        status={editor}
        readOnly={readOnly}
        onSave={onSave}
        onDiscard={editor.discard}
      >
        <EditorSection id="general" title="General" card={card}>
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
            <div className="flex flex-col gap-2">
              <Link href={`/templates/${template.id}`} className="w-fit text-sm font-medium text-accent hover:underline">
                {template.name}
              </Link>
              <div className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
                Publishes
                {template.metrics.length ? template.metrics.map((m) => <Tag key={m.key ?? m.name} mono>{m.key}</Tag>) : " nothing"}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
                Controls
                {template.actuators.length ? template.actuators.map((a) => <Tag key={a.key ?? a.name} mono>{a.key}</Tag>) : " nothing"}
              </div>
            </div>
          ) : (
            <LoadingSkeleton rows={2} rowClassName="h-5" />
          )}
        </EditorSection>

        {embedded && (
          <EditorSection id="connection" title="Connection" card={card}>
            <Field label="MQTT username" hint="Stored with an argon2id-hashed password, so a password is only ever shown once.">
              <CopyField value={device.id} label="MQTT username" />
            </Field>
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-3.5 py-3">
                <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
                  Get a ready-to-flash sketch with a new credential. The firmware running now disconnects until you flash the new one.
                </p>
                <Link href={`/devices/${device.id}/connect`} className={buttonClassName({ variant: "secondary" })}>
                  <Cpu aria-hidden size={14} />
                  Connect and get firmware
                </Link>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <h4 className="text-[13px] font-semibold text-ink">MQTT topics</h4>
              <DeviceTopics device={device} template={template} />
            </div>
          </EditorSection>
        )}

        {embedded && !readOnly && (
          <EditorSection id="danger" title="Danger zone" card tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 max-w-[52ch]">
                <p className="text-sm font-medium text-ink">Delete this device</p>
                <p className="text-[13px] text-ink-muted">
                  Its credential stops working{ruleCount ? `, ${plural(ruleCount, "rule")} stop evaluating it` : ""} and its telemetry history is removed.
                </p>
              </div>
              <Button variant="danger" onClick={() => void remove()}>
                <Trash2 aria-hidden size={14} />
                Delete device…
              </Button>
            </div>
          </EditorSection>
        )}
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
