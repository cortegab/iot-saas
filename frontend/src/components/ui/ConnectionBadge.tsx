import { Badge, type DotShape, type StatusTone } from "@/components/ui/Badge";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type ConnectionState = DeviceResponse["connection_state"];

/** DESIGN.md §3 device vocabulary: Online (online) · Offline (offline) ·
 * Never connected (pending, hollow dot). */
const TONE: Record<ConnectionState, StatusTone> = {
  online: "online",
  offline: "offline",
  never_connected: "pending",
};
const SHAPE: Record<ConnectionState, DotShape> = {
  online: "solid",
  offline: "solid",
  never_connected: "hollow",
};
const LABEL: Record<ConnectionState, string> = {
  get online() { return t("status.device.online"); },
  get offline() { return t("status.device.offline"); },
  get never_connected() { return t("status.device.never"); },
};

/** Device connection state as a status pill — never colour alone: every state
 * pairs a dot shape with a word. */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <Badge tone={TONE[state]} shape={SHAPE[state]} label={LABEL[state]} />;
}

/** A device's overall status pill: Disabled wins over its connection state. */
export function DeviceStatusPill({ device }: { device: Pick<DeviceResponse, "status" | "connection_state"> }) {
  const s = DEVICE_STATUS[deviceStatusKey(device)];
  return <Badge tone={s.tone} shape={s.shape} label={s.label} />;
}
