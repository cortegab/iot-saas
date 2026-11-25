import type { components } from "@iodriven/shared/api";
import { useState } from "react";
import { Alert } from "react-native";
import { useApi } from "@/hooks/useApi";
import { Lines, Row } from "@/ui/Row";
import { Switch } from "@/ui/Switch";

type DeviceResponse = components["schemas"]["DeviceResponse"];

/** "Until I turn them back on", as the web stores it. */
const FOREVER = "9999-12-31T00:00:00Z";

/** The web's device Alerts (DESIGN.md §8; ease-of-use C6) on a phone: offline
 * and health alerts on or muted, and a back-online notice. Admins only; muting
 * never stops rules. Off mutes until it's turned back on; the web also has
 * "for 1 hour / 1 day". */
export function AlertSettings({ device, onSaved }: { device: DeviceResponse; onSaved: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  // The time this screen opened: a mute running out while it's open shows on the next visit.
  const [now] = useState(() => Date.now());
  const muted = device.alerts_muted_until != null && Date.parse(device.alerts_muted_until) > now;

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/devices/${device.id}`, body);
      onSaved();
    } catch {
      Alert.alert("Couldn't change its alerts", "Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Lines label="Alerts">
      <Row
        title="Offline and health alerts"
        detail={muted ? "Muted. Its rules still run and notify." : "On. Muting doesn't stop its rules."}
        right={
          <Switch
            value={!muted}
            disabled={busy}
            onValueChange={(on) => void save({ alerts_muted_until: on ? null : FOREVER })}
            accessibilityLabel="Offline and health alerts"
          />
        }
      />
      <Row
        title="Tell me when it's back online"
        detail="A notification when it reconnects after going offline."
        right={
          <Switch
            value={device.notify_back_online}
            disabled={busy}
            onValueChange={(on) => void save({ notify_back_online: on })}
            accessibilityLabel="Tell me when it's back online"
          />
        }
      />
    </Lines>
  );
}
