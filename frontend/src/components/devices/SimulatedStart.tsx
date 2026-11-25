"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EDITOR_COLUMN, PAGE_WITH_BAR, SAVE_BAR } from "@/components/editor/save-bar";
import { ApiRequestError } from "@/lib/api-client";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { applyKit, kitsFor } from "@/lib/starter-kits";
import { blankTemplate, draftToRequest } from "@/lib/template-draft";
import { blankHardware } from "@/lib/hardware/hardware-draft";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** "Bay (simulated)", then "Bay (simulated) 2"… among names already taken. */
function freeName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * Add device → Try it without a board (ease-of-use plan B4): a simulated
 * device built from a starter kit. The platform makes up its readings every
 * 5 s and answers its commands (backend app.devices.simulator), so rules,
 * alerts and dashboards can be tried before any hardware. It gets a template
 * of its own, made from the kit's readings and outputs.
 */
export function SimulatedStart({ cards }: { cards: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const { data: firmware, isLoading } = useDriverCatalog();
  const { data: templates } = useApiSWR<CatalogEntryResponse[]>("/catalog");
  const kits = kitsFor(firmware);
  const [kitId, setKitId] = useState("greenhouse");
  const kit = kits.find((k) => k.id === kitId) ?? kits[0];
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownName = name.trim() || (kit ? `${kit.title} (simulated)` : "");

  async function create() {
    if (!kit || !firmware) return;
    setSubmitting(true);
    setError(null);
    try {
      const built = applyKit({ ...blankTemplate("generic_firmware"), name: shownName, hardware: blankHardware() }, kit, firmware);
      // No board, so no wiring: the template lists what the kit reads and switches.
      const template = draftToRequest({ ...built, runsOn: "own_code", hardware: null });
      const result = await api.post<DeviceCreateResponse>("/devices", {
        name: shownName,
        simulated: true,
        new_template: { ...template, name: freeName(shownName, (templates ?? []).map((t) => t.name)) },
      });
      void revalidate("/devices");
      void revalidate("/catalog");
      router.push(`/devices/${result.device.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }]}
        title={shownName || "Add device"}
        description="A device whose readings the platform makes up, so you can try rules and dashboards before any hardware."
      />
      <div className={`${PAGE_WITH_BAR} ${EDITOR_COLUMN} @container gap-6`}>
        {cards}
        {isLoading ? (
          <p className="text-sm text-ink-muted">Loading the kits…</p>
        ) : kits.length === 0 ? (
          <p className="text-sm text-ink-muted">No firmware release is published yet, so there are no kits to simulate.</p>
        ) : (
          <>
            <ChoiceCards<string>
              ariaLabel="What it simulates"
              value={kit?.id ?? ""}
              onChange={setKitId}
              options={kits.map((k) => ({ value: k.id, title: k.title, description: k.description }))}
            />
            <Field label="Device name" hint="Shown in lists and alerts, marked Simulated.">
              <Input value={name} placeholder={kit ? `${kit.title} (simulated)` : ""} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="text-meta text-ink-muted">
              New readings every 5 seconds. Its outputs answer commands, and a fan cools it, so a rule visibly does its job. A workspace
              can have three. Stop simulating it from its page when a real board takes over.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
        <div data-savebar className={SAVE_BAR}>
          <span className="mr-auto text-meta text-ink-muted">Not created yet</span>
          <Link href="/devices" className={buttonClassName({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="button" disabled={submitting || !kit} onClick={() => void create()}>
            {submitting ? "Creating…" : "Create simulated device"}
          </Button>
        </div>
      </div>
    </>
  );
}

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];

/** The recipe a simulated device is best tried with, filled with its names:
 * an output and a temperature-ish reading make "too hot"; a number alone,
 * "too high"; an on/off reading, "stays open". */
export function tryRuleHref(deviceId: string, metrics: CatalogMetric[], actuators: CatalogActuator[]): string | null {
  const key = (x: { key?: string | null; name: string }) => x.key ?? x.name;
  const numbers = metrics.filter((m) => m.data_type !== "bool");
  const output = actuators.find((a) => (a.value_type ?? "bool") === "bool");
  const warm = numbers.find((m) => /temp/i.test(`${m.key} ${m.name}`)) ?? numbers[0];
  const base = `/rules/new?device=${deviceId}`;
  if (warm && output)
    return `${base}&recipe=too-hot&metric=${encodeURIComponent(key(warm))}&actuatorDevice=${deviceId}&actuator=${encodeURIComponent(key(output))}`;
  if (warm) return `${base}&recipe=reading-high&metric=${encodeURIComponent(key(warm))}`;
  const flag = metrics.find((m) => m.data_type === "bool");
  if (flag) return `${base}&recipe=door-open&metric=${encodeURIComponent(key(flag))}`;
  return null;
}

/** On a simulated device's Overview: what it is, a rule to try, and Stop
 * simulating for when a real board takes over (it keeps its template and
 * credential; Connect installs the board). */
export function SimulatedNote({
  device,
  metrics,
  actuators,
  canWrite,
  canWriteRules,
}: {
  device: DeviceResponse;
  metrics: CatalogMetric[];
  actuators: CatalogActuator[];
  canWrite: boolean;
  canWriteRules: boolean;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const href = canWriteRules ? tryRuleHref(device.id, metrics, actuators) : null;
  async function stop() {
    setBusy(true);
    try {
      await api.patch(`/devices/${device.id}`, { simulated: false });
      void revalidate(`/devices/${device.id}`);
      void revalidate("/devices");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Callout>
      <b className="font-medium">Simulated.</b> The platform makes up its readings every 5 seconds and answers its commands
      {actuators.length > 0 ? "; switching a fan on cools it." : "."}{" "}
      {href && (
        <Link href={href} className="text-accent underline-offset-[3px] hover:underline">
          Try a rule on it
        </Link>
      )}
      {canWrite && (
        <>
          {href && " · "}
          <Button variant="link" className="text-sm" disabled={busy} onClick={() => void stop()}>
            Stop simulating
          </Button>
        </>
      )}
    </Callout>
  );
}
