"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button, buttonClassName } from "@/components/ui/Button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Breadcrumbs, PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import { ApiRequestError } from "@/lib/api-client";
import { handOffCredential } from "@/lib/credential-handoff";
import type { RunsOn } from "@/lib/template-draft";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

type Start = "same" | "new";

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
  const start: Start = legacy || params.get("from") === "new" ? "new" : "same";
  const runs = legacy ? "generic" : params.get("runs");
  const runsOn = runs === "generic" || runs === "own" ? RUNS[runs] : "generic_firmware";
  const cards = (
    <ChoiceCards<Start>
      ariaLabel="How to start"
      value={start}
      onChange={(v) => router.replace(v === "new" ? "/devices/new?from=new" : "/devices/new")}
      options={[
        { value: "same", title: "From a template", description: "Another device like one you already have." },
        { value: "new", title: "Something new", description: "Say what it runs on and what it has; we make its template." },
      ]}
    />
  );
  if (start === "same") return <FromTemplate cards={cards} />;
  return (
    <>
      <Breadcrumbs crumbs={[{ href: "/devices", label: "Devices" }, { label: "Add device" }]} />
      <TemplateEditor key={runsOn} entryId={null} onboard runsOn={runsOn} mode="page" intro={cards} />
    </>
  );
}

function FromTemplate({ cards }: { cards: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: allEntries } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const { data: zones } = useApiSWR<ZoneResponse[]>("/zones");
  // Disabled templates can't be picked for new devices (DESIGN.md §8).
  const templates = allEntries?.filter((e) => e.status === "active");
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [templateId, setTemplateId] = useState(searchParams.get("catalog_entry_id") ?? "");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const template = templates?.find((t) => t.id === templateId);

  // Default to the first template (a fresh tenant always has its "Legacy /
  // Uncategorized" one — devices/service.py), unless one was handed in.
  useEffect(() => {
    if (templates && templates.length > 0 && !templateId) setTemplateId(templates[0].id);
  }, [templates, templateId]);

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
      handOffCredential(result.device, result.credential);
      router.push(`/devices/${result.device.id}/connect`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  const byRuns = (r: RunsOn) => (templates ?? []).filter((t) => (t.runs_on ?? "own_code") === r);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { label: "Add device" }]}
        title="Add device"
        description="Name it and pick its template. Next come its credential and Install."
      />
      <form onSubmit={(e) => void handleSubmit(e)} className="@container flex max-w-[760px] flex-col gap-6">
        {cards}
        <div className="grid gap-3.5 @min-[560px]:grid-cols-2">
          <Field label="Device name" hint="Shown in lists and alerts. Its MQTT id is made from it and never changes.">
            <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. bay1-climate" />
          </Field>
          <Field label="Zone" optional>
            <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">No zone</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Template" hint={<Link href="/templates" className="text-accent hover:underline">Manage templates</Link>}>
          <Select required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {!templates && <option value="">Loading…</option>}
            {(["generic_firmware", "own_code"] as const).map((r) =>
              byRuns(r).length ? (
                <optgroup key={r} label={r === "generic_firmware" ? "Our firmware" : "Custom firmware"}>
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
        {template && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-raised px-4 py-3.5 text-sm">
            <span className="text-[13px] font-medium text-ink-muted">It gives you</span>
            <p className="text-ink">
              <b className="font-medium">Readings: </b>
              {template.metrics.length ? template.metrics.map((m) => m.name || wireId(m)).join(", ") : "none"}
            </p>
            <p className="text-ink">
              <b className="font-medium">Switches: </b>
              {template.actuators.length ? template.actuators.map((a) => a.name || wireId(a)).join(", ") : "none"}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <div className="sticky bottom-[var(--tabbar-h)] z-[6] -mx-4 flex items-center justify-end gap-2 border-t border-border bg-canvas/92 px-4 py-3 backdrop-blur-[10px] rail:-mx-10 rail:px-10">
          <span className="mr-auto text-[13px] text-ink-muted">Not created yet</span>
          <Link href="/devices" className={buttonClassName({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="submit" disabled={submitting || !templateId || !name.trim()}>
            {submitting ? "Creating…" : "Create device"}
          </Button>
        </div>
      </form>
    </>
  );
}
