"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate as revalidate } from "swr";
import { Plus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/lib/api-client";
import { handOffCredential } from "@/lib/credential-handoff";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];
type ZoneResponse = components["schemas"]["ZoneResponse"];

/** Add a device: name, template, zone. Creating it goes straight to the
 * connect flow with the one-time credential handed over in memory. */
export default function NewDevicePage() {
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
