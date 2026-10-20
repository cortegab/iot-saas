"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Code2, Cpu, Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Breadcrumbs, PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import { ApiRequestError } from "@/lib/api-client";
import { handOffCredential } from "@/lib/credential-handoff";
import type { RunsOn } from "@/lib/template-draft";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

type From = "same" | "new";

const RUNS: Record<"generic" | "own", RunsOn> = { generic: "generic_firmware", own: "own_code" };

/** Add a device (DESIGN.md §8): **From a template** (name, template,
 * zone) or **Something new**: how it runs, then the template editor in
 * onboarding mode, which makes its template too. Either way, creating it goes
 * straight to the connect flow with the one-time credential handed over in
 * memory. `?from=hardware` (older links) is Something new on our firmware. */
export default function NewDevicePage() {
  const router = useRouter();
  const params = useSearchParams();
  const legacy = params.get("from") === "hardware";
  const from: From = legacy || params.get("from") === "new" ? "new" : "same";
  const runs = legacy ? "generic" : params.get("runs");
  const runsOn = runs === "generic" || runs === "own" ? RUNS[runs] : null;
  const modes = (
    <SegmentedControl<From>
      ariaLabel="Start from"
      size="md"
      className="mb-4 w-fit"
      value={from}
      onChange={(v) => router.replace(v === "new" ? "/devices/new?from=new" : "/devices/new")}
      options={[
        { value: "same", label: "From a template" },
        { value: "new", label: "Something new" },
      ]}
    />
  );
  if (from === "same") return <FromTemplate modes={modes} />;
  return (
    <>
      <Breadcrumbs crumbs={[{ href: "/devices", label: "Devices" }, { label: "Add device" }]} />
      {modes}
      {runsOn ? (
        <TemplateEditor key={runsOn} entryId={null} onboard runsOn={runsOn} mode="page" />
      ) : (
        <RunsOnChoice onPick={(r) => router.replace(`/devices/new?from=new&runs=${r}`)} />
      )}
    </>
  );
}

/** Something new, first question: how will it run? (DESIGN.md §8 "Runs on") */
function RunsOnChoice({ onPick }: { onPick: (runs: "generic" | "own") => void }) {
  const choices = [
    {
      runs: "generic" as const,
      icon: <Cpu aria-hidden size={18} />,
      title: "Our firmware",
      body: "An ESP32 board you wire yourself. Pick the board and its parts; it installs from the browser, no code.",
    },
    {
      runs: "own" as const,
      icon: <Code2 aria-hidden size={18} />,
      title: "Custom firmware or gateway",
      body: "Your own firmware, a PLC gateway or another service. List the data it sends; it publishes to the topics itself.",
    },
  ];
  return (
    <section aria-labelledby="runs-on" className="flex max-w-3xl flex-col gap-3">
      <h2 id="runs-on" className="text-[15px] font-semibold text-ink">
        How will this device run?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((c) => (
          <button
            key={c.runs}
            type="button"
            onClick={() => onPick(c.runs)}
            className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 text-left shadow-card hover:border-accent/50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="text-accent">{c.icon}</span>
              {c.title}
            </span>
            <span className="text-[13px] text-ink-muted">{c.body}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FromTemplate({ modes }: { modes: ReactNode }) {
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
      handOffCredential(result.device.id, result.credential);
      router.push(`/devices/${result.device.id}/connect`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { label: "Add device" }]}
        title="Add device"
        description="Name it and pick its template. Next comes the credential and the firmware to flash."
      />
      {modes}
      <form onSubmit={(e) => void handleSubmit(e)} className="flex max-w-lg flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-card">
        <Field label="Name" hint="Shown in lists and alerts. Its MQTT id is made from it and never changes.">
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. bay1-climate" />
        </Field>
        <Field label="Template" hint={<Link href="/templates" className="text-accent hover:underline">Manage templates</Link>}>
          <Select required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {!templates && <option value="">Loading…</option>}
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {zones && zones.length > 0 && (
          <Field label="Zone" optional>
            <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">No zone</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting || !templateId || !name.trim()}>
            <Plus aria-hidden size={15} />
            {submitting ? "Creating…" : "Create and connect"}
          </Button>
          <Link href="/devices" className="inline-flex h-control items-center rounded-md px-3.5 text-sm text-ink-muted hover:text-ink">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
