"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { UnitField } from "@/components/catalog/UnitField";
import { EditorFrame, EditorSection, type EditorMode } from "@/components/editor/EditorFrame";
import { useRecordEditor } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import {
  blankActuator,
  blankMetric,
  blankTemplate,
  brokenUsages,
  draftToRequest,
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DIFF: DiffField<TemplateDraft>[] = [
  { label: "Name", get: (d) => d.name.trim() },
  { label: "Availability", get: (d) => d.enabled, format: (v) => (v ? "Enabled" : "Disabled") },
  { label: "Metrics", get: (d) => d.metrics.map((m) => m.key.trim()) },
  { label: "Actuators", get: (d) => d.actuators.map((a) => a.key.trim()) },
];

const PUBLISH_LABEL = { periodic: "Every N seconds", on_change: "When it changes", streaming: "As fast as it samples" } as const;
const CONTROL_LABEL = { bool: "On/off switch", float: "Level (number)", string: "Choice from a list" } as const;

/**
 * The device-template editor (DESIGN.md §8) on the shared editor chrome:
 * General · Metrics · Actuators. Keys follow the name until edited, used keys
 * are locked (with a rename warning when unlocked), every key shows its MQTT
 * topic, and saving a change that disconnects rules or widgets asks first.
 */
export function TemplateEditor({
  entryId,
  duplicateOf,
  mode = "page",
}: {
  /** null = new template. */
  entryId: string | null;
  duplicateOf?: string | null;
  mode?: EditorMode;
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

  const isNew = entryId == null;
  const initial = useMemo<TemplateDraft | null>(() => {
    if (!isNew) return entry ? templateToDraft(entry) : null;
    if (duplicateOf) return source ? templateToDraft(source, { duplicate: true }) : null;
    return blankTemplate();
  }, [isNew, entry, duplicateOf, source]);

  const otherNames = useMemo(() => (all ?? []).filter((e) => e.id !== entryId).map((e) => e.name), [all, entryId]);
  const validate = useCallback((d: TemplateDraft) => validateTemplate(d, { otherNames, usage }), [otherNames, usage]);
  const editor = useRecordEditor({ source: initial, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, entry?.name ?? "this template");

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

  const set = (next: TemplateDraft) => editor.set(next);
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
        const body = draftToRequest(draft);
        try {
          if (isNew) {
            const created = await api.post<CatalogEntryResponse>("/catalog", {
              name: body.name,
              metrics: body.metrics as unknown as Record<string, unknown>[],
              actuators: body.actuators as unknown as Record<string, unknown>[],
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
  const consequence = isNew
    ? d.enabled
      ? "Creating it makes it available in Add device."
      : "It's created disabled, so it won't be offered in Add device yet."
    : devices
      ? `Saving updates ${plural(devices, "device")} and re-sends their telemetry profile within seconds.`
      : "No devices use it yet.";

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
        noun="device template"
        title={isNew ? (d.name.trim() || "New device template") : d.name.trim() || entry!.name}
        eyebrow={
          <>
            Device template
            {!isNew && (d.enabled ? <Badge tone="online" label="Enabled" /> : <Badge tone="unknown" shape="square" label="Disabled" />)}
            {!isNew && <span>· {plural(devices, "device")}</span>}
          </>
        }
        consequence={consequence}
        sections={[
          { id: "general", label: "General", description: "Name and availability" },
          { id: "metrics", label: "Metrics", count: d.metrics.length, description: "What the device publishes" },
          { id: "actuators", label: "Actuators", count: d.actuators.length, description: "What the platform can switch" },
        ]}
        status={editor}
        readOnly={readOnly}
        saveLabel={isNew ? "Create template" : "Save"}
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
        menu={!isNew && !readOnly ? [[{ label: "Delete template…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }]] : undefined}
      >
        <EditorSection id="general" title="General">
          <div className="grid gap-3.5 @[640px]:grid-cols-2">
            <Field label="Template name" {...f("general.name")}>
              <Input
                value={d.name}
                disabled={readOnly}
                placeholder="e.g. Climate sensor v2"
                onChange={(e) => set({ ...d, name: e.target.value })}
                onBlur={blur("general.name")}
              />
            </Field>
            <SwitchField
              label="Availability"
              checked={d.enabled}
              disabled={readOnly}
              onChange={(enabled) => set({ ...d, enabled })}
              onLabel="Enabled"
              offLabel="Disabled"
              onHint="Offered in Add device."
              offHint="Hidden from Add device. Devices that already use it keep working."
            />
          </div>
        </EditorSection>

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
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
