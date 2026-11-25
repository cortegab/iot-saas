"use client";

import { useState } from "react";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** "Until I turn them back on" is stored as a far-future time. */
const FOREVER = "9999-12-31T00:00:00Z";
const FOREVER_AFTER = Date.parse("9000-01-01T00:00:00Z");

/** Whether its alerts are muted right now. */
export function isMuted(device: Pick<DeviceResponse, "alerts_muted_until">): boolean {
  return device.alerts_muted_until != null && Date.parse(device.alerts_muted_until) > Date.now();
}

function mutedLabel(until: string): string {
  const t = Date.parse(until);
  if (t > FOREVER_AFTER) return "Muted until you turn them back on.";
  return `Muted until ${new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`;
}

/**
 * A device's alert settings (DESIGN.md §8; ease-of-use C6), applied at once:
 * mute its offline and health alerts for a while, and say when it's back
 * online. Muting never touches rules: they keep running and notifying.
 */
export function DeviceAlertSettings({ device, canWrite }: { device: DeviceResponse; canWrite: boolean }) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const muted = isMuted(device);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await api.patch(`/devices/${device.id}`, body);
      void revalidate(`/devices/${device.id}`);
      void revalidate("/devices");
      toast({ title: done });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change its alerts", detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  function mute(choice: string) {
    if (choice === "off") return void save({ alerts_muted_until: null }, `${device.name}'s alerts are on`);
    const until = choice === "forever" ? FOREVER : new Date(Date.now() + Number(choice) * 3600_000).toISOString();
    void save({ alerts_muted_until: until }, `${device.name}'s alerts are muted`);
  }

  return (
    <section aria-labelledby="device-alerts" className="mb-6 flex max-w-[760px] flex-col gap-3 border-b border-border-soft pb-6">
      <h2 id="device-alerts" className="text-section font-semibold text-ink">
        Alerts
      </h2>
      <Field
        label="Offline and health alerts"
        hint={muted ? `${mutedLabel(device.alerts_muted_until!)} Rules still run and notify.` : "On. Muting doesn't stop its rules."}
      >
        <Select value={muted ? "muted" : "off"} disabled={!canWrite || busy} onChange={(e) => mute(e.target.value)} className="max-w-[280px]">
          <option value="off">On</option>
          {muted && <option value="muted">Muted</option>}
          <option value="1">Mute for 1 hour</option>
          <option value="24">Mute for 1 day</option>
          <option value="forever">Mute until I turn them back on</option>
        </Select>
      </Field>
      <SwitchField
        label="Back online"
        checked={device.notify_back_online}
        disabled={!canWrite || busy}
        onChange={(on) => void save({ notify_back_online: on }, on ? "You'll hear when it's back online" : "No back-online notice")}
        onLabel="Tell me when it's back online"
        offLabel="Off"
        onHint="A notification when it reconnects after going offline."
        offHint="Only going offline is an alert."
      />
    </section>
  );
}
