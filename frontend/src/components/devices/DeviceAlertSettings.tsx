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
import { activeLocale, intlLocale, tActive as tr } from "@iodriven/shared/i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** "Until I turn them back on" is stored as a far-future time. */
const FOREVER = "9999-12-31T00:00:00Z";
const FOREVER_AFTER = Date.parse("9000-01-01T00:00:00Z");

/** Whether its alerts are muted right now. */
export function isMuted(device: Pick<DeviceResponse, "alerts_muted_until">): boolean {
  return device.alerts_muted_until != null && Date.parse(device.alerts_muted_until) > Date.now();
}

function mutedLabel(until: string): string {
  const at = Date.parse(until);
  if (at > FOREVER_AFTER) return tr("devices.alerts.mutedForever");
  return tr("devices.alerts.mutedUntil", { when: new Date(at).toLocaleString(intlLocale(activeLocale()), { weekday: "short", hour: "numeric", minute: "2-digit" }) });
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
      toast({ tone: "error", title: tr("devices.alerts.changeFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  function mute(choice: string) {
    if (choice === "off") return void save({ alerts_muted_until: null }, tr("devices.alerts.alertsOn", { name: device.name }));
    const until = choice === "forever" ? FOREVER : new Date(Date.now() + Number(choice) * 3600_000).toISOString();
    void save({ alerts_muted_until: until }, tr("devices.alerts.alertsMuted", { name: device.name }));
  }

  return (
    <section aria-labelledby="device-alerts" className="mb-6 flex max-w-[760px] flex-col gap-3 border-b border-border-soft pb-6">
      <h2 id="device-alerts" className="text-section font-semibold text-ink">
        {tr("devices.alerts.title")}
      </h2>
      <Field
        label={tr("devices.alerts.label")}
        hint={muted ? tr("devices.alerts.mutedHint", { until: mutedLabel(device.alerts_muted_until!) }) : tr("devices.alerts.onHint")}
      >
        <Select value={muted ? "muted" : "off"} disabled={!canWrite || busy} onChange={(e) => mute(e.target.value)} className="max-w-[280px]">
          <option value="off">{tr("devices.alerts.on")}</option>
          {muted && <option value="muted">{tr("devices.alerts.muted")}</option>}
          <option value="1">{tr("devices.alerts.hour")}</option>
          <option value="24">{tr("devices.alerts.day")}</option>
          <option value="forever">{tr("devices.alerts.forever")}</option>
        </Select>
      </Field>
      <SwitchField
        label={tr("devices.alerts.backOnline")}
        checked={device.notify_back_online}
        disabled={!canWrite || busy}
        onChange={(on) => void save({ notify_back_online: on }, on ? tr("devices.alerts.savedOn") : tr("devices.alerts.savedOff"))}
        onLabel={tr("devices.alerts.backOnlineOn")}
        offLabel={tr("devices.alerts.off")}
        onHint={tr("devices.alerts.backOnlineOnHint")}
        offHint={tr("devices.alerts.backOnlineOffHint")}
      />
    </section>
  );
}
