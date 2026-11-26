"use client";

import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { BookOpen, Copy, Cpu, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { WiringSection } from "@/components/catalog/WiringSection";
import { ActuatorsSection } from "@/components/catalog/template/ActuatorsSection";
import { GeneralSection } from "@/components/catalog/template/GeneralSection";
import { MetricsSection } from "@/components/catalog/template/MetricsSection";
import type { Draft, SectionProps } from "@/components/catalog/template/section-props";
import {
  EditorFrame,
  EditorSection,
  type EditorGroupDef,
  type EditorMode,
  type EditorSectionDef,
} from "@/components/editor/EditorFrame";
import { ReviewList } from "@/components/editor/ReviewList";
import { useRecordEditor } from "@/components/editor/useRecordEditor";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { ApiRequestError } from "@/lib/api-client";
import { changeSummary, diffLines, type DiffField } from "@/lib/diff-summary";
import { findDriver, useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { resolveModel } from "@/lib/hardware/board-pins";
import { blankHardware } from "@/lib/hardware/hardware-draft";
import {
  blankTemplate,
  brokenUsages,
  draftToRequest,
  EMPTY_TEMPLATE_WARNING,
  keepReading,
  keyedRows,
  matchingTemplate,
  reconcileParts,
  renamed,
  templateSectionOrder,
  templateToDraft,
  unfedRows,
  usageText,
  validateTemplate,
  type RunsOn,
  type TemplateDraft,
  type TemplateSectionId,
} from "@/lib/template-draft";
import { applyKit, kitsFor } from "@/lib/starter-kits";
import type { components } from "@/types/api";
import { NotFound, isNotFound } from "@/components/ui/NotFound";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type CatalogUsageResponse = components["schemas"]["CatalogUsageResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

const DIFF: DiffField<TemplateDraft>[] = [
  { get label() { return tr("tpl.diff.name"); }, get: (d) => d.name.trim() },
  { get label() { return tr("tpl.diff.status"); }, get: (d) => d.enabled, format: (v) => (v ? tr("tpl.enabled") : tr("tpl.disabled")) },
  { get label() { return tr("tpl.diff.runsOn"); }, get: (d) => d.runsOn, format: (v) => (v === "generic_firmware" ? tr("tpl.ourFirmware") : tr("tpl.customFirmware")) },
  { get label() { return tr("tpl.diff.metrics"); }, get: (d) => d.metrics.map((m) => m.key.trim()) },
  { get label() { return tr("tpl.diff.actuators"); }, get: (d) => d.actuators.map((a) => a.key.trim()) },
  {
    get label() { return tr("tpl.diff.wiring"); },
    get: (d) =>
      d.hardware
        ? tr("tpl.diff.wiringValue", { inputs: d.hardware.inputs.length, outputs: d.hardware.outputs.length, board: d.hardware.board })
        : tr("tpl.diff.none"),
  },
];

/** The rail entry for a section, worded for how the devices run. */
function railEntry(id: TemplateSectionId, d: Draft): EditorSectionDef {
  const parts = d.runsOn === "generic_firmware";
  switch (id) {
    case "general":
      return { id, label: tr("tpl.rail.general"), description: d.device ? tr("tpl.rail.generalDevice") : tr("tpl.rail.generalTemplate") };
    case "hardware":
      return { id, label: tr("tpl.rail.wiring"), description: tr("tpl.rail.wiringSub") };
    case "metrics":
      return { id, label: tr("tpl.rail.metrics"), count: d.metrics.length, description: parts ? tr("tpl.rail.metricsParts") : tr("tpl.rail.metricsOwn") };
    case "actuators":
      return { id, label: tr("tpl.rail.actuators"), count: d.actuators.length, description: parts ? tr("tpl.rail.actuatorsParts") : tr("tpl.rail.actuatorsOwn") };
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
  intro,
}: {
  /** null = new template. */
  entryId: string | null;
  duplicateOf?: string | null;
  mode?: EditorMode;
  onboard?: boolean;
  /** How a new template's (or onboarded device's) devices run, to start with. */
  runsOn?: RunsOn;
  /** Above the first step's question (Add device's start cards). */
  intro?: ReactNode;
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
      const deviceError = !name ? tr("setup.nameRequired") : name.length > 100 ? tr("setup.nameLong") : null;
      return deviceError ? { ...v, errors: { ...v.errors, "general.device": deviceError } } : v;
    },
    [otherNames, usage, catalog],
  );
  const editor = useRecordEditor<Draft>({ source: initial, isNew, validate });
  const { dialog: guardDialog } = useUnsavedGuard(editor.dirty, onboard ? tr("tpl.thisDevice") : (entry?.name ?? tr("tpl.thisTemplate")));

  if (isNotFound(error)) return <NotFound noun="template" href="/templates" list="templates" />;
  if (error) {
    return (
      <div className="p-5">
        <ErrorState
          title={tr("tpl.loadFailed")}
          message={error instanceof ApiRequestError ? error.message : tr("tpl.noResponse")}
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
      const ok = await confirm(tr("tpl.disconnectBody"), {
        title: tr("tpl.disconnectTitle"),
        confirmLabel: tr("tpl.saveAnyway"),
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
    // A new device just like an existing template's: offer that template
    // instead of another copy (DESIGN.md §8, templates surface on reuse).
    let twin: CatalogEntryResponse | undefined;
    const match = d!.device && Object.keys(editor.errors).length === 0 ? matchingTemplate(d!, all ?? [], drivers) : undefined;
    if (match) {
      const ok = await confirm(tr("tpl.matchBody", { template: match.name }), {
        title: tr("tpl.matchTitle", { template: match.name }),
        confirmLabel: tr("tpl.matchUse", { template: match.name }),
        cancelLabel: tr("tpl.matchNew"),
        danger: false,
      });
      if (ok) twin = match;
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
              ...(twin ? { catalog_entry_id: twin.id } : { new_template: { name: body.name, ...parts } }),
            });
            void revalidate("/devices");
            void revalidate("/catalog");
            router.push(`/devices/${result.device.id}/connect?fresh=1`);
          } else if (isNew) {
            const created = await api.post<CatalogEntryResponse>("/catalog", { name: body.name, ...parts });
            if (!draft.enabled) await api.patch(`/catalog/${created.id}`, { status: "disabled" });
            void revalidate("/catalog");
            toast({ title: tr("tpl.created"), detail: tr(draft.enabled ? "tpl.createdOn" : "tpl.createdOff", { template: created.name }) });
            router.replace(`/templates/${created.id}`);
          } else {
            await api.patch(`/catalog/${entryId}`, { ...body, ...parts });
            await mutate();
            toast({ title: tr("tpl.saved"), detail: before ? changeSummary(diffLines(before, draft, DIFF)) : undefined });
          }
        } catch (err) {
          toast({ tone: "error", title: tr("tpl.rejected"), detail: err instanceof ApiRequestError ? err.message : undefined });
          throw err;
        }
      })
      .catch(() => false);
  }

  async function remove() {
    if (!entry) return;
    if (entry.device_count > 0) {
      await confirm(tr("tpl.inUseBody", { count: entry.device_count }), {
        title: tr("tpl.inUseTitle", { template: entry.name }),
        confirmLabel: tr("tpl.ok"),
        cancelLabel: tr("tpl.close"),
        danger: false,
      });
      return;
    }
    if (!(await confirm(tr("tpl.deleteBody"), { title: tr("tpl.deleteTitle", { template: entry.name }), confirmLabel: tr("tpl.deleteConfirm") }))) return;
    try {
      await api.delete(`/catalog/${entry.id}`);
      void revalidate("/catalog");
      toast({ title: tr("tpl.deleted", { template: entry.name }) });
      router.push("/templates");
    } catch (err) {
      toast({ tone: "error", title: tr("tpl.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const devices = entry?.device_count ?? 0;
  const consequence = d.device
    ? tr("tpl.consDevice")
    : isNew
    ? d.enabled
      ? tr("tpl.consNewOn")
      : tr("tpl.consNewOff")
    : devices
      ? tr("tpl.consSave", { count: devices })
      : tr("tpl.consNone");

  // A reading's metric (or a command's actuator), renamed on its part card.
  // Removing or replacing a part, or dropping a reading, names what rules and
  // dashboards lose before it happens (DESIGN.md §8). The metrics stay.
  const guardUnfed = (next: Draft) => {
    const hit = unfedRows(d, next)
      .map(({ kind, row }) => ({ row, used: row.origKey ? usageText(usage?.[kind][row.origKey]) : "" }))
      .filter((x) => x.used);
    if (hit.length === 0) return set(next);
    void confirm(tr("tpl.unfedBody"), {
      title: tr("tpl.unfedTitle"),
      confirmLabel: tr("tpl.unfedConfirm"),
      details: (
        <ul>
          {hit.map(({ row, used }) => (
            <li key={row.uid}>
              {tr("tpl.usedBy", { name: row.name || row.key, key: row.key, used })}
            </li>
          ))}
        </ul>
      ),
    }).then((ok) => {
      if (ok) set(next);
    });
  };

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
      // The wizard step already says this as its lead; say it once (DESIGN.md §7).
      lead={isNew ? undefined : tr("tpl.wiringLead")}
      hardware={d.hardware}
      rows={keyedRows(d)}
      readOnly={readOnly}
      onChange={(hardware) => guardUnfed({ ...reconcileParts(d, hardware, catalog), device: d.device })}
      field={(path) => ({ ...f(path), onBlur: blur(path) })}
      onRenameTarget={renameTarget}
      targetError={targetError}
      onKeepReading={(bindingUid, channel, keep) => guardUnfed({ ...keepReading(d, bindingUid, channel, keep, catalog), device: d.device })}
      guideHref={entryId ? `/templates/${entryId}/wiring` : undefined}
    >
      {!catalogLoading && !catalog && (
        <p className="text-sm text-ink-muted">
          {richT(tr, "tpl.noRelease", { custom: <b className="text-ink">{tr("tpl.customFirmware")}</b> })}
        </p>
      )}
    </WiringSection>
  );
  // A new build with no parts yet can start from a kit (ease-of-use B3): the
  // same parts Add part would add, on free pins, named, all still editable.
  const kits = isNew && !readOnly && d.hardware && d.hardware.inputs.length + d.hardware.outputs.length === 0 ? kitsFor(catalog) : [];
  const kitPicker = kits.length > 0 && catalog && (
    <section aria-labelledby="kit-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h3 id="kit-heading" className="text-sm font-semibold text-ink">
          {tr("tpl.kitTitle")}
        </h3>
        <p className="text-meta text-ink-muted">{tr("tpl.kitLead")}</p>
      </div>
      <ul aria-label={tr("tpl.kits")} className="grid gap-2.5 sm:grid-cols-2">
        {kits.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              onClick={() => {
                set({ ...applyKit(d, k, catalog), device: d.device });
                toast({ title: tr("tpl.kitAdded", { kit: k.title }), detail: tr("tpl.kitAddedDetail") });
              }}
              className="flex h-full w-full flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 text-left shadow-card hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]"
            >
              <strong className="text-sm font-semibold text-ink">{k.title}</strong>
              <span className="text-meta text-ink-muted">{k.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
  const body: Record<TemplateSectionId, ReactNode> = {
    general: <GeneralSection {...props} zones={zones} />,
    hardware: (
      <>
        {kitPicker}
        {wiring}
      </>
    ),
    metrics: <MetricsSection {...props} />,
    actuators: <ActuatorsSection {...props} />,
  };
  const order = templateSectionOrder({ runsOn: d.runsOn });
  const parts = d.runsOn === "generic_firmware";

  // DESIGN.md §7/§8: creating is a wizard (Basics → Hardware → Data →
  // Review); editing is tabs (General · Wiring · Data).
  const groups: EditorGroupDef[] = isNew
    ? [
        {
          id: "basics",
          label: tr("tpl.basics"),
          sections: ["general"],
          question: d.device ? tr("tpl.qDevice") : tr("tpl.qTemplate"),
          lead: d.device ? tr("tpl.leadDevice") : tr("tpl.leadTemplate"),
        },
        ...(parts
          ? [
              {
                id: "hardware",
                label: tr("tpl.hardware"),
                sections: ["hardware"],
                question: tr("tpl.qHardware"),
                lead: tr("tpl.leadHardware"),
              },
            ]
          : []),
        {
          id: "data",
          label: tr("tpl.data"),
          sections: ["metrics", "actuators"],
          question: tr("tpl.qData"),
          lead: parts ? tr("tpl.leadDataParts") : tr("tpl.leadDataOwn"),
        },
        { id: "review", label: tr("tpl.review"), sections: ["review"], question: d.device ? tr("tpl.qReviewDevice") : tr("tpl.qReviewTemplate"), lead: consequence },
      ]
    : [
        { id: "general", label: tr("tpl.general"), sections: ["general"] },
        ...(parts ? [{ id: "wiring", label: tr("tpl.wiring"), sections: ["hardware"] }] : []),
        { id: "data", label: tr("tpl.data"), sections: ["metrics", "actuators"] },
      ];

  const none = (n: number, s: string) => (n ? undefined : <span className="text-ink-muted">{s}</span>);
  const review = isNew && (
    <EditorSection id="review" title={tr("tpl.summary")}>
      <ReviewList
        rows={[
          d.device
            ? { label: tr("tpl.device"), value: d.device.name.trim() || <span className="text-ink-muted">{tr("tpl.unnamed")}</span>, step: "basics" }
            : { label: tr("tpl.template"), value: d.name.trim() || <span className="text-ink-muted">{tr("tpl.unnamed")}</span>, step: "basics" },
          { label: tr("tpl.runsOn"), value: parts ? tr("tpl.ourFirmware") : tr("tpl.customFirmware"), step: "basics" },
          ...(parts
            ? [
                {
                  label: tr("tpl.boardParts"),
                  value: d.hardware ? (
                    <>
                      {resolveModel(catalog?.models, d.hardware.board)?.label ?? d.hardware.board}
                      <span className="block text-meta text-ink-muted">
                        {[...d.hardware.inputs, ...d.hardware.outputs].map((b) => findDriver(drivers ?? [], b.driver)?.label ?? b.driver).join("; ") || tr("tpl.noParts")}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">{tr("tpl.noWiring")}</span>
                  ),
                  step: "hardware",
                },
              ]
            : []),
          {
            label: tr("tpl.metrics"),
            value: none(d.metrics.length, tr("tpl.none")) ?? (
              <>
                {d.metrics.map((m, i) => (
                  <Fragment key={m.uid}>
                    {i > 0 && ", "}
                    {m.name || tr("tpl.unnamed")} <span className="font-mono text-xs text-ink-muted">{m.key}</span>
                  </Fragment>
                ))}
              </>
            ),
            step: "data",
          },
          { label: tr("tpl.actuators"), value: none(d.actuators.length, tr("tpl.none")) ?? d.actuators.map((a) => a.name || tr("tpl.unnamed")).join(", "), step: "data" },
        ]}
      />
      {editor.warningFor(EMPTY_TEMPLATE_WARNING) && (
        <Callout tone="warning">
          <b className="font-medium">{tr("tpl.nothing")}</b> {editor.warningFor(EMPTY_TEMPLATE_WARNING)}
        </Callout>
      )}
      {editor.visibleErrors.length > 0 && (
        <div role="alert">
          <Callout tone="error">
            <b className="font-medium">{tr("tpl.problems", { count: editor.visibleErrors.length })}</b> {tr("tpl.marked")}
          </Callout>
        </div>
      )}
    </EditorSection>
  );

  return (
    <>
      <EditorFrame
        mode={mode}
        noun={d.device ? "device" : "device template"}
        title={d.device ? d.device.name.trim() || tr("tpl.addDevice") : isNew ? d.name.trim() || tr("tpl.newTemplate") : d.name.trim() || entry!.name}
        eyebrow={
          d.device || isNew ? undefined : <>
            {d.enabled ? <Badge tone="online" variant="dot" label={tr("tpl.enabled")} /> : <Badge tone="unknown" shape="square" variant="dot" label={tr("tpl.disabled")} />}
            <span>· {tr("tpl.devices", { count: devices })}</span>
          </>
        }
        // Adding something new says what the wizard does (demo H); a new template
        // says it on its Review step.
        consequence={d.device ? tr("tpl.consDeviceFrame") : isNew ? undefined : consequence}
        sections={order.map((id) => railEntry(id, d))}
        nav={isNew ? "steps" : "tabs"}
        groups={groups}
        onTouch={editor.touchAll}
        intro={intro}
        status={editor}
        readOnly={readOnly}
        saveLabel={d.device ? tr("tpl.createDevice") : isNew ? tr("tpl.createTemplate") : tr("tpl.save")}
        onSave={onSave}
        onDiscard={editor.discard}
        headerActions={
          !isNew && !readOnly ? (
            <Button variant="secondary" onClick={() => router.push(`/templates/new?duplicate=${entryId}`)}>
              <Copy aria-hidden size={14} />
              {tr("tpl.duplicate")}
            </Button>
          ) : undefined
        }
        menu={
          !isNew
            ? [
                [
                  { label: tr("tpl.viewDevices"), icon: <Cpu size={15} />, onClick: () => router.push(`/devices?template=${entryId}`) },
                  ...(entry?.hardware && entry.runs_on === "generic_firmware" ? [{ label: tr("tpl.wiringGuide"), icon: <BookOpen size={15} />, onClick: () => router.push(`/templates/${entryId}/wiring`) }] : []),
                ],
                ...(readOnly ? [] : [[{ label: tr("tpl.delete"), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }]]),
              ]
            : undefined
        }
      >
        {order.map((id) => (
          <Fragment key={id}>{body[id]}</Fragment>
        ))}
        {review}
      </EditorFrame>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
