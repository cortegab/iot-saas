"use client";

import { EDITOR_COLUMN, PAGE_WITH_BAR, SAVE_BAR } from "@/components/editor/save-bar";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button, buttonClassName } from "@/components/ui/Button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { FactList } from "@/components/ui/FactList";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Breadcrumbs, PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { SimulatedStart } from "@/components/devices/SimulatedStart";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import { templateGivesFacts } from "@/components/catalog/template-facts";
import { ApiRequestError } from "@/lib/api-client";
import type { RunsOn } from "@/lib/template-draft";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

type Start = "same" | "new" | "simulated";

const RUNS: Record<"generic" | "own", RunsOn> = { generic: "generic_firmware", own: "own_code" };

/** Add a device (DESIGN.md §8, demo H): two starts as cards. **From a
 * template** is one form (name, zone, template, what it gives you).
 * **Something new** is the template wizard in onboarding mode — Basics
 * (device name, zone, Runs on) → Hardware → Data → Review — which makes its
 * template too. Either way, creating it goes straight to Connect with the
 * credential handed over. `?from=new` starts on Something new; `&runs=own`
 * (and the older `?from=hardware`) still preset how it runs. */
export default function NewDevicePage() {
  const router = useRouter();
  const params = useSearchParams();
  const legacy = params.get("from") === "hardware";
  const from = params.get("from");
  const start: Start = legacy || from === "new" ? "new" : from === "simulated" ? "simulated" : "same";
  const runs = legacy ? "generic" : params.get("runs");
  const runsOn = runs === "generic" || runs === "own" ? RUNS[runs] : "generic_firmware";
  const cards = (
    <ChoiceCards<Start>
      ariaLabel={tr("setup.howStart")}
      value={start}
      onChange={(v) => router.replace(v === "same" ? "/devices/new" : `/devices/new?from=${v}`)}
      options={[
        { value: "same", title: tr("setup.fromTemplate"), description: tr("setup.fromTemplateHint") },
        { value: "new", title: tr("setup.somethingNew"), description: tr("setup.somethingNewHint") },
        // Ease-of-use B4: try rules and dashboards before any hardware.
        { value: "simulated", title: tr("setup.noBoard"), description: tr("setup.noBoardHint") },
      ]}
    />
  );
  if (start === "same") return <FromTemplate cards={cards} />;
  if (start === "simulated") return <SimulatedStart cards={cards} />;
  return (
    <>
      <Breadcrumbs crumbs={[{ href: "/devices", label: tr("devices.title") }]} />
      <TemplateEditor key={runsOn} entryId={null} onboard runsOn={runsOn} mode="page" intro={cards} />
    </>
  );
}

function isEmptyLegacy(e: CatalogEntryResponse): boolean {
  return e.is_legacy && (e.metrics?.length ?? 0) === 0 && (e.actuators?.length ?? 0) === 0;
}

function FromTemplate({ cards }: { cards: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: allEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  // Disabled templates can't be picked for new devices (DESIGN.md §8), nor
  // the empty "Legacy / Uncategorized" one every workspace starts with: a
  // device on it has nothing to send, so a first device never showed a reading.
  const templates = allEntries?.filter((e) => e.status === "active" && !isEmptyLegacy(e));
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [templateId, setTemplateId] = useState(searchParams.get("catalog_entry_id") ?? "");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const template = templates?.find((t) => t.id === templateId);

  // Default to the first template, unless one was handed in. With none yet,
  // "Something new" is the only way to start.
  useEffect(() => {
    if (templates && templates.length > 0 && !templateId) setTemplateId(templates[0].id);
    if (templates && templates.length === 0) router.replace("/devices/new?from=new");
  }, [templates, templateId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<DeviceCreateResponse>("/devices", {
        name: name.trim(),
        catalog_entry_id: templateId,
        ...(zoneId ? { zone_id: zoneId } : {}),
      });
      void revalidate("/devices");
      // Connect starts by creating its credential (DESIGN.md §8): the one
      // made here is never shown.
      router.push(`/devices/${result.device.id}/connect?fresh=1`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : tr("setup.failed"));
      setSubmitting(false);
    }
  }

  const byRuns = (r: RunsOn) => (templates ?? []).filter((t) => (t.runs_on ?? "own_code") === r);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: tr("devices.title") }]}
        // The typed name becomes the title, as on New template (DESIGN.md §4).
        title={name.trim() || tr("setup.addDevice")}
        description={tr("setup.addLead")}
      />
      <form onSubmit={(e) => void handleSubmit(e)} className={`${PAGE_WITH_BAR} ${EDITOR_COLUMN} @container gap-6`}>
        {cards}
        <div className="grid gap-3.5 @min-[560px]:grid-cols-2">
          <Field label={tr("setup.deviceName")} hint={tr("setup.deviceNameHint")}>
            <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("setup.deviceNamePlaceholder")} />
          </Field>
          <Field label={tr("setup.zone")} optional>
            <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">{tr("setup.noZone")}</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={tr("setup.template")}
          hint={
            <>
              {tr("setup.templateHint")}{" "}
              <Link href="/templates" className="link-inline">
                {tr("setup.manageTemplates")}
              </Link>
            </>
          }
        >
          <Select required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {!templates && <option value="">{tr("common.loading")}</option>}
            {(["generic_firmware", "own_code"] as const).map((r) =>
              byRuns(r).length ? (
                <optgroup key={r} label={r === "generic_firmware" ? tr("setup.ourFirmware") : tr("setup.customFirmware")}>
                  {byRuns(r).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </Select>
        </Field>
        {template && <FactList facts={templateGivesFacts(template)} />}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <div data-savebar className={SAVE_BAR}>
          <span className="mr-auto text-meta text-ink-muted">{tr("ui.editor.notCreated")}</span>
          <Link href="/devices" className={buttonClassName({ variant: "ghost" })}>
            {tr("ui.cancel")}
          </Link>
          <Button type="submit" disabled={submitting || !templateId || !name.trim()}>
            {submitting ? tr("setup.creating") : tr("setup.create")}
          </Button>
        </div>
      </form>
    </>
  );
}
