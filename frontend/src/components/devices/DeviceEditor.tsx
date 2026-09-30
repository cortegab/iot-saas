"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Tag } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { SwitchField } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor, type Validation } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];

interface DeviceDraft {
  name: string;
  enabled: boolean;
}

const DIFF: DiffField<DeviceDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Rule evaluation", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
];

function validate(d: DeviceDraft): Validation {
  const errors: Record<string, string> = {};
  if (!d.name.trim()) errors["identity.name"] = "Give the device a name.";
  else if (d.name.trim().length > 100) errors["identity.name"] = "Keep the name under 100 characters.";
  return { errors };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Edit a device's name and rule evaluation (DESIGN.md §7/§8). Zone and
 * template change join once the backend accepts them. */
export function DeviceEditor({
  deviceId,
  mode,
  onClose,
  expandHref,
  dockHref,
}: {
  deviceId: string;
  mode: EditorMode;
  onClose?: () => void;
  expandHref?: string;
  dockHref?: string;
}) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const readOnly = !can("devices.write");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: device, error, mutate } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");

  const source = useMemo<DeviceDraft | null>(
    () => (device ? { name: device.name, enabled: device.status === "active" } : null),
    [device],
  );
  const editor = useRecordEditor({ source, validate });
  const { confirmLeave, dialog: guardDialog } = useUnsavedGuard(editor.dirty, device ? device.name : "this device");

  const ruleCount = useMemo(
    () => (rules ?? []).filter((r) => r.devices.some((d) => d.device_id === deviceId)).length,
    [rules, deviceId],
  );

  const close = useCallback(async () => {
    if (await confirmLeave()) onClose?.();
  }, [confirmLeave, onClose]);

  async function onSave(): Promise<boolean> {
    const before = editor.original;
    return editor.save(async (d) => {
      const body: Record<string, unknown> = {};
      if (d.name.trim() !== device?.name) body.name = d.name.trim();
      if (d.enabled !== (device?.status === "active")) body.status = d.enabled ? "active" : "disabled";
      try {
        await api.patch(`/devices/${deviceId}`, body);
      } catch (err) {
        toast({ tone: "error", title: "The server rejected the change", detail: err instanceof ApiRequestError ? err.message : undefined });
        throw err;
      }
      await mutate();
      toast({ title: "Device saved", detail: before ? changeSummary(diffLines(before, d, DIFF)) : undefined });
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

  return (
    <>
      <EditorFrame
        mode={mode}
        noun="device"
        title={d.name.trim() || device.name}
        eyebrow={
          <>
            Device <DeviceStatusPill device={device} />
          </>
        }
        consequence={consequence}
        sections={[
          { id: "identity", label: "Identity", description: "Name and template" },
          { id: "status", label: "Status", description: "Whether rules evaluate it" },
        ]}
        status={editor}
        readOnly={readOnly}
        onSave={onSave}
        onDiscard={editor.discard}
        onClose={onClose ? () => void close() : undefined}
        expandHref={expandHref}
        dockHref={dockHref}
        menu={[
          [
            { label: "Open device page", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/devices/${device.id}`) },
            ...(readOnly
              ? []
              : [{ label: "Credentials and firmware", icon: <KeyRound size={15} />, onClick: () => router.push(`/devices/${device.id}?tab=settings`) }]),
          ],
          ...(readOnly ? [] : [[{ label: "Delete device…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }]]),
        ]}
      >
        <EditorSection id="identity" title="Identity">
          <Field label="Name" error={editor.errorFor("identity.name")} hint="Shown in lists, dashboards and alerts.">
            <Input
              value={d.name}
              disabled={readOnly}
              onChange={(e) => editor.set({ ...d, name: e.target.value })}
              onBlur={() => editor.touch("identity.name")}
            />
          </Field>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-canvas px-3.5 py-3">
            <span className="text-xs font-medium text-ink-muted">Template</span>
            {template ? (
              <>
                <Link href={`/templates/${template.id}`} className="text-sm font-medium text-ink hover:text-accent hover:underline">
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
              </>
            ) : (
              <LoadingSkeleton rows={1} rowClassName="h-5" />
            )}
          </div>
        </EditorSection>

        <EditorSection id="status" title="Status">
          <SwitchField
            label="Rule evaluation"
            checked={d.enabled}
            disabled={readOnly}
            onChange={(enabled) => editor.set({ ...d, enabled })}
            onLabel="Enabled"
            offLabel="Disabled"
            onHint="Rules evaluate its readings and it can connect."
            offHint="Rules ignore it and its connections are refused. Telemetry history is kept."
          />
        </EditorSection>
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
