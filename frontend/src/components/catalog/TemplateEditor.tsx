"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Copy, Lock, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Affix, Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { HardwareSection } from "@/components/catalog/HardwareSection";
import { UnitField } from "@/components/catalog/UnitField";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import { handOffCredential } from "@/lib/credential-handoff";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { blankHardware } from "@/lib/hardware/hardware-draft";
import {
  blankActuator,
  blankMetric,
  blankTemplate,
  brokenUsages,
  draftToRequest,
  keyedRows,
  reconcileParts,
  renamed,
  templateToDraft,
  usageText,
  validateTemplate,
  type ActuatorDraft,
  type MetricDraft,
  type TemplateDraft,
} from "@/lib/template-draft";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogUsageResponse = components["schemas"]["CatalogUsageResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

/** Onboarding "from the hardware": the device created with the template. */
interface OnboardDevice {
  name: string;
  zoneId: string;
  /** The template name still follows the device name (until edited). */
  templateNameAuto: boolean;
}
type Draft = TemplateDraft & { device?: OnboardDevice };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DIFF: DiffField<TemplateDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Status", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
  { label: "Metrics", get: (d) => d.metrics.map((m) => m.key.trim()) },
  { label: "Actuators", get: (d) => d.actuators.map((a) => a.key.trim()) },
  {
    label: "Wiring",
    get: (d) => (d.hardware ? `${d.hardware.inputs.length} in · ${d.hardware.outputs.length} out (${d.hardware.board})` : "none"),
  },
];

const PUBLISH_LABEL = { periodic: "Every N seconds", on_change: "When it changes", streaming: "As fast as it samples" } as const;
const CONTROL_LABEL = { bool: "On/off switch", float: "Level (number)", string: "Choice from a list" } as const;

/**
 * The device-template editor (DESIGN.md §8) on the shared editor chrome:
 * General · Metrics · Actuators. Keys follow the name until edited, used keys
 * are locked (with a rename warning when unlocked), every key shows its MQTT
 * topic, and saving a change that disconnects rules or widgets asks first.
 *
 * `onboard`: adding a device "from the hardware" (/devices/new?from=hardware).
 * The same editor, with the device's name and zone on top and the wiring
 * first; its parts bring their metrics and actuators (reconcileParts), and
 * saving creates the template and the device in one call.
 */
export function TemplateEditor({
  entryId,
  duplicateOf,
  mode = "page",
  onboard = false,
}: {
  /** null = new template. */
  entryId: string | null;
  duplicateOf?: string | null;
  mode?: EditorMode;
  onboard?: boolean;
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
  const { data: catalog, error: catalogError, isLoading: catalogLoading } = useDriverCatalog();
  const drivers = catalog?.drivers;
  const { data: zones } = useApiSWR<ZoneResponse[]>(onboard ? "/zones" : null);

  const isNew = entryId == null;
  const initial = useMemo<Draft | null>(() => {
    if (onboard) return { ...blankTemplate(), metrics: [], hardware: blankHardware(), device: { name: "", zoneId: "", templateNameAuto: true } };
    if (!isNew) return entry ? templateToDraft(entry) : null;
    if (duplicateOf) return source ? templateToDraft(source, { duplicate: true }) : null;
    return blankTemplate();
  }, [onboard, isNew, entry, duplicateOf, source]);

  const otherNames = useMemo(() => (all ?? []).filter((e) => e.id !== entryId).map((e) => e.name), [all, entryId]);
  const validate = useCallback(
    (d: Draft) => {
      const v = validateTemplate(d, { otherNames, usage, catalog });
      if (!d.device) return v;
      const name = d.device.name.trim();
      const deviceError = !name ? "Give the device a name." : name.length > 100 ? "Keep the name under 100 characters." : null;
      return deviceError ? { ...v, errors: { ...v.errors, "general.device": deviceError } } : v;
    },
    [otherNames, usage, catalog],
  );
  const editor = useRecordEditor<Draft>({ source: initial, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, onboard ? "this device" : (entry?.name ?? "this template"));

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState<{ metrics: boolean | null; actuators: boolean | null }>({ metrics: null, actuators: null });
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

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
  const setMetric = (i: number, m: MetricDraft) => set({ ...d, metrics: d.metrics.map((x, j) => (j === i ? m : x)) });
  const setActuator = (i: number, a: ActuatorDraft) => set({ ...d, actuators: d.actuators.map((x, j) => (j === i ? a : x)) });
  const f = (path: string) => ({ error: editor.errorFor(path), warning: editor.warningFor(path) });
  const blur = (path: string) => () => editor.touch(path);

  const isOpen = (kind: "metrics" | "actuators", row: { uid: string; origKey: string | null }, i: number) => {
    const hasError = editor.visibleErrors.some((p) => p.startsWith(`${kind}.${i}.`));
    if (hasError || expanded.has(row.uid) || row.origKey == null) return true;
    const pref = allOpen[kind];
    if (pref != null) return pref;
    return mode === "page" && d[kind].length <= 3;
  };
  const toggleRow = (uid: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

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
        try {
          if (draft.device) {
            const result = await api.post<DeviceCreateResponse>("/devices", {
              name: draft.device.name.trim(),
              ...(draft.device.zoneId ? { zone_id: draft.device.zoneId } : {}),
              new_template: {
                name: body.name,
                metrics: body.metrics as unknown as Record<string, unknown>[],
                actuators: body.actuators as unknown as Record<string, unknown>[],
                hardware: body.hardware as unknown as Record<string, unknown> | null,
              },
            });
            void revalidate("/devices");
            void revalidate("/catalog");
            handOffCredential(result.device.id, result.credential);
            router.push(`/devices/${result.device.id}/connect`);
          } else if (isNew) {
            const created = await api.post<CatalogEntryResponse>("/catalog", {
              name: body.name,
              metrics: body.metrics as unknown as Record<string, unknown>[],
              actuators: body.actuators as unknown as Record<string, unknown>[],
              hardware: body.hardware as unknown as Record<string, unknown> | null,
            });
            if (!draft.enabled) await api.patch(`/catalog/${created.id}`, { status: "disabled" });
            void revalidate("/catalog");
            toast({ title: "Template created", detail: `${created.name} is ${draft.enabled ? "available in Add device" : "disabled"}.` });
            router.replace(`/templates/${created.id}`);
          } else {
            await api.patch(`/catalog/${entryId}`, {
              ...body,
              metrics: body.metrics as unknown as Record<string, unknown>[],
              actuators: body.actuators as unknown as Record<string, unknown>[],
              hardware: body.hardware as unknown as Record<string, unknown> | null,
            });
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

  // Wiring comes last when editing a template, first when onboarding from
  // the hardware. Adding a part brings its metrics and actuators (reconcileParts).
  const wiringSection = (
    <EditorSection
      id="hardware"
      title="Wiring"
      lead={
        d.device
          ? "Pick the board, then add each part. Every part brings its metrics or actuators below; rename or delete them as you like."
          : "How the board is wired: which sensor reads each metric and which output drives each actuator. Adding a part also adds its metrics or actuators. Optional, but with it every device installs from the browser with no code."
      }
    >
      <HardwareSection
        hardware={d.hardware}
        rows={keyedRows(d)}
        catalog={{ data: catalog, loading: catalogLoading, error: !!catalogError }}
        readOnly={readOnly}
        onChange={(hardware) => set({ ...reconcileParts(d, hardware, catalog), device: d.device })}
        field={(path) => ({ ...f(path), onBlur: blur(path) })}
      />
      {d.device && !catalogLoading && !catalog && (
        <p className="text-sm text-ink-muted">
          Until a firmware release is published, add the device{" "}
          <Link href="/devices/new" className="text-accent hover:underline">
            from a template
          </Link>
          .
        </p>
      )}
    </EditorSection>
  );

  const keyField = (kind: "metrics" | "actuators", i: number, row: MetricDraft | ActuatorDraft, topic: string) => {
    const path = `${kind}.${i}.key`;
    const used = row.origKey ? usageText(usage?.[kind][row.origKey]) : "";
    const locked = !!used && !unlocked.has(row.uid) && row.key === row.origKey;
    const hint = (
      <>
        <span className="font-mono">{topic}</span>
        {used && <> · used by {used}</>}
      </>
    );
    return (
      <Field
        label={
          <span className="flex items-center gap-1.5">
            Key {row.keyAuto && <Tag size="sm">auto</Tag>}
            {locked && <Lock aria-label="Locked: in use" size={11} />}
          </span>
        }
        {...f(path)}
        hint={hint}
      >
        <div className="flex items-center gap-2">
          <Input
            mono
            value={row.key}
            disabled={readOnly || locked}
            onChange={(e) => {
              const next = { ...row, key: e.target.value, keyAuto: false };
              if (kind === "metrics") setMetric(i, next as MetricDraft);
              else setActuator(i, next as ActuatorDraft);
            }}
            onBlur={blur(path)}
          />
          {locked && !readOnly && (
            <Button variant="link" className="shrink-0 text-xs" onClick={() => setUnlocked((s) => new Set(s).add(row.uid))}>
              Unlock
            </Button>
          )}
        </div>
      </Field>
    );
  };

  const rowSummary = (kind: "metrics" | "actuators", i: number, row: MetricDraft | ActuatorDraft, desc: string) => {
    const used = row.origKey ? usageText(usage?.[kind][row.origKey]) : "";
    const hasErr = Object.keys(editor.errors).some((p) => p.startsWith(`${kind}.${i}.`));
    const hasWarn = !!editor.warningFor(`${kind}.${i}.key`);
    return (
      <button
        type="button"
        onClick={() => toggleRow(row.uid)}
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
  };

  const rowCard = (children: ReactNode, onCollapse: () => void, onRemove: () => void, title: string) => (
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

  const expandToggle = (kind: "metrics" | "actuators") => {
    if (d[kind].length < 2) return undefined;
    const openNow = d[kind].every((r, i) => isOpen(kind, r, i));
    return (
      <Button
        variant="link"
        className="inline-flex items-center gap-1 text-[12.5px] font-medium"
        onClick={() => {
          setExpanded(new Set());
          setAllOpen((s) => ({ ...s, [kind]: !openNow }));
        }}
      >
        {openNow ? <ChevronDown aria-hidden size={13} /> : <ChevronRight aria-hidden size={13} />}
        {openNow ? "Collapse all" : "Expand all"}
      </Button>
    );
  };

  const span2 = "col-span-2";

  return (
    <>
      <EditorFrame
        mode={mode}
        noun={d.device ? "device" : "device template"}
        title={d.device ? d.device.name.trim() || "New device" : isNew ? d.name.trim() || "New device template" : d.name.trim() || entry!.name}
        eyebrow={
          <>
            {d.device ? "Device, from the hardware" : "Device template"}
            {!isNew && (d.enabled ? <Badge tone="online" label="Enabled" /> : <Badge tone="unknown" shape="square" label="Disabled" />)}
            {!isNew && <span>· {plural(devices, "device")}</span>}
          </>
        }
        consequence={consequence}
        sections={
          d.device
            ? [
                { id: "general", label: "General", description: "Device and template names" },
                { id: "hardware", label: "Wiring", description: "The board and its parts" },
                { id: "metrics", label: "Metrics", count: d.metrics.length, description: "What its parts read" },
                { id: "actuators", label: "Actuators", count: d.actuators.length, description: "What its parts switch" },
              ]
            : [
                { id: "general", label: "General", description: "Name and availability" },
                { id: "metrics", label: "Metrics", count: d.metrics.length, description: "What the device publishes" },
                { id: "actuators", label: "Actuators", count: d.actuators.length, description: "What the platform can switch" },
                { id: "hardware", label: "Wiring", description: "For installing from the browser" },
              ]
        }
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
        <EditorSection id="general" title="General">
          <div className="grid gap-3.5 @[640px]:grid-cols-2">
            {d.device && (
              <>
                <Field label="Device name" hint="Shown in lists and alerts. Its MQTT id is made from it and never changes." {...f("general.device")}>
                  <Input
                    autoFocus
                    value={d.device.name}
                    disabled={readOnly}
                    placeholder="e.g. bay1-climate"
                    onChange={(e) => {
                      const device = { ...d.device!, name: e.target.value };
                      set({ ...d, device, name: device.templateNameAuto ? e.target.value : d.name });
                    }}
                    onBlur={blur("general.device")}
                  />
                </Field>
                {zones && zones.length > 0 && (
                  <Field label="Zone" optional>
                    <Select value={d.device.zoneId} disabled={readOnly} onChange={(e) => set({ ...d, device: { ...d.device!, zoneId: e.target.value } })}>
                      <option value="">No zone</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            <Field
              label="Template name"
              hint={d.device ? "Saved as a template too, so the next board like this one is Add device → From a template." : undefined}
              {...f("general.name")}
            >
              <Input
                value={d.name}
                disabled={readOnly}
                placeholder="e.g. Climate sensor v2"
                onChange={(e) => set({ ...d, name: e.target.value, ...(d.device ? { device: { ...d.device, templateNameAuto: false } } : {}) })}
                onBlur={blur("general.name")}
              />
            </Field>
            {!d.device && (
            <SwitchField
              label="Status"
              checked={d.enabled}
              disabled={readOnly}
              onChange={(enabled) => set({ ...d, enabled })}
              onLabel="Enabled"
              offLabel="Disabled"
              onHint="Offered in Add device."
              offHint="Hidden from Add device. Devices that already use it keep working."
            />
            )}
          </div>
        </EditorSection>

        {d.device && wiringSection}

        <EditorSection
          id="metrics"
          title="Metrics"
          lead="What the device publishes. Each key is the last segment of an MQTT topic."
          actions={expandToggle("metrics")}
        >
          <div className="flex flex-col gap-2">
            {d.metrics.length === 0 && <p className="text-sm text-ink-muted">No metrics. Add one for each reading the device sends.</p>}
            {d.metrics.map((m, i) => {
              const desc =
                m.data_type === "bool"
                  ? "On/off flag"
                  : [m.unit, m.min !== "" || m.max !== "" ? `${m.min || "…"} to ${m.max || "…"}` : null, PUBLISH_LABEL[m.publish].toLowerCase()]
                      .filter(Boolean)
                      .join(" · ");
              if (!isOpen("metrics", m, i)) return <div key={m.uid}>{rowSummary("metrics", i, m, desc)}</div>;
              const p = `metrics.${i}.`;
              return (
                <div key={m.uid}>
                  {rowCard(
                    <>
                      <Field label="Name" {...f(p + "name")} className={span2}>
                        <Input value={m.name} disabled={readOnly} placeholder="e.g. Temperature" onChange={(e) => setMetric(i, renamed(m, e.target.value))} onBlur={blur(p + "name")} />
                      </Field>
                      <div className={span2}>{keyField("metrics", i, m, `…/{device}/${m.key.trim() || "key"}`)}</div>
                      <Field label="Type">
                        <Select
                          value={m.data_type}
                          disabled={readOnly}
                          onChange={(e) => setMetric(i, { ...m, data_type: e.target.value as MetricDraft["data_type"] })}
                        >
                          <option value="float">Number</option>
                          <option value="bool">On/off</option>
                        </Select>
                      </Field>
                      {m.data_type === "float" ? (
                        <>
                          <Field label="Unit" optional>
                            <UnitField value={m.unit} onChange={(unit) => setMetric(i, { ...m, unit })} />
                          </Field>
                          <Field label="Decimals" {...f(p + "decimals")}>
                            <Input inputMode="numeric" value={m.decimals} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, decimals: e.target.value })} onBlur={blur(p + "decimals")} />
                          </Field>
                          <Field label="Min" optional {...f(p + "min")}>
                            <Input inputMode="decimal" value={m.min} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, min: e.target.value })} onBlur={blur(p + "min")} />
                          </Field>
                          <Field label="Max" optional {...f(p + "max")}>
                            <Input inputMode="decimal" value={m.max} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, max: e.target.value })} onBlur={blur(p + "max")} />
                          </Field>
                        </>
                      ) : (
                        <p className="col-span-3 self-end pb-2 text-xs text-ink-muted">Sends 0 or 1. No unit or range.</p>
                      )}
                      <Field label="Publish" className={span2}>
                        <Select value={m.publish} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, publish: e.target.value as MetricDraft["publish"] })}>
                          {(Object.keys(PUBLISH_LABEL) as MetricDraft["publish"][]).map((k) => (
                            <option key={k} value={k}>
                              {PUBLISH_LABEL[k]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {m.publish === "on_change" ? (
                        <Field label="Change of at least" optional {...f(p + "deadband")} className={span2}>
                          <Affix suffix={m.unit || "units"}>
                            <Input inputMode="decimal" value={m.deadband} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, deadband: e.target.value })} onBlur={blur(p + "deadband")} />
                          </Affix>
                        </Field>
                      ) : (
                        <Field label="Every" optional {...f(p + "interval")} className={span2}>
                          <Affix suffix="s">
                            <Input inputMode="numeric" value={m.interval} disabled={readOnly} onChange={(e) => setMetric(i, { ...m, interval: e.target.value })} onBlur={blur(p + "interval")} />
                          </Affix>
                        </Field>
                      )}
                    </>,
                    () => {
                      setExpanded((s) => {
                        const n = new Set(s);
                        n.delete(m.uid);
                        return n;
                      });
                      setAllOpen((s) => ({ ...s, metrics: false }));
                    },
                    () => set({ ...d, metrics: d.metrics.filter((x) => x.uid !== m.uid) }),
                    m.name || "New metric",
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <Button
                variant="link"
                className="self-start"
                onClick={() => {
                  const m = blankMetric();
                  set({ ...d, metrics: [...d.metrics, m] });
                  setExpanded((s) => new Set(s).add(m.uid));
                }}
              >
                <Plus aria-hidden size={14} />
                Add metric
              </Button>
            )}
          </div>
        </EditorSection>

        <EditorSection
          id="actuators"
          title="Actuators"
          lead="What the platform can switch. Commands go out on QoS 1 with a 30 s TTL."
          actions={expandToggle("actuators")}
        >
          <div className="flex flex-col gap-2">
            {d.actuators.length === 0 && <p className="text-sm text-ink-muted">No actuators. Sensors-only devices don&apos;t need any.</p>}
            {d.actuators.map((a, i) => {
              const desc = a.value_type === "bool" ? `On/off · sends ${a.on || "…"} / ${a.off || "…"}` : CONTROL_LABEL[a.value_type];
              if (!isOpen("actuators", a, i)) return <div key={a.uid}>{rowSummary("actuators", i, a, desc)}</div>;
              const p = `actuators.${i}.`;
              return (
                <div key={a.uid}>
                  {rowCard(
                    <>
                      <Field label="Name" {...f(p + "name")} className={span2}>
                        <Input value={a.name} disabled={readOnly} placeholder="e.g. Fan" onChange={(e) => setActuator(i, renamed(a, e.target.value))} onBlur={blur(p + "name")} />
                      </Field>
                      <div className={span2}>{keyField("actuators", i, a, `…/{device}/cmd/${a.key.trim() || "key"}`)}</div>
                      <Field label="Control" className={span2}>
                        <Select value={a.value_type} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, value_type: e.target.value as ActuatorDraft["value_type"] })}>
                          {(Object.keys(CONTROL_LABEL) as ActuatorDraft["value_type"][]).map((k) => (
                            <option key={k} value={k}>
                              {CONTROL_LABEL[k]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {a.value_type === "bool" && (
                        <>
                          <Field label="Sends for On" {...f(p + "on")}>
                            <Input mono value={a.on} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, on: e.target.value })} onBlur={blur(p + "on")} />
                          </Field>
                          <Field label="Sends for Off" {...f(p + "off")}>
                            <Input mono value={a.off} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, off: e.target.value })} onBlur={blur(p + "off")} />
                          </Field>
                        </>
                      )}
                      {a.value_type === "string" && (
                        <Field label="Allowed values" hint="Separated by commas, e.g. open, closed, half" {...f(p + "allowed")} className={span2}>
                          <Input mono value={a.allowed} disabled={readOnly} onChange={(e) => setActuator(i, { ...a, allowed: e.target.value })} onBlur={blur(p + "allowed")} />
                        </Field>
                      )}
                      {a.value_type === "float" && <p className="col-span-2 self-end pb-2 text-xs text-ink-muted">Sends the number you choose.</p>}
                    </>,
                    () => {
                      setExpanded((s) => {
                        const n = new Set(s);
                        n.delete(a.uid);
                        return n;
                      });
                      setAllOpen((s) => ({ ...s, actuators: false }));
                    },
                    () => set({ ...d, actuators: d.actuators.filter((x) => x.uid !== a.uid) }),
                    a.name || "New actuator",
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <Button
                variant="link"
                className="self-start"
                onClick={() => {
                  const a = blankActuator();
                  set({ ...d, actuators: [...d.actuators, a] });
                  setExpanded((s) => new Set(s).add(a.uid));
                }}
              >
                <Plus aria-hidden size={14} />
                Add actuator
              </Button>
            )}
          </div>
        </EditorSection>

        {!d.device && wiringSection}
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
