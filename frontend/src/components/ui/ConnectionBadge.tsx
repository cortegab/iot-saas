import { Badge, type StatusTone } from "@/components/ui/Badge";
import type { components } from "@/types/api";

type ConnectionState = components["schemas"]["DeviceResponse"]["connection_state"];

const TONE: Record<ConnectionState, StatusTone> = {
  online: "online",
  offline: "offline",
  never_connected: "unknown",
};
const LABEL: Record<ConnectionState, string> = {
  online: "Online",
  offline: "Offline",
  never_connected: "Never connected",
};

/**
 * Status is never color-alone (UX_UI_Description.md's Accessibility section):
 * every state pairs a dot with a text label, so it reads the same to a
 * color-blind user or a screen reader. Thin wrapper over `Badge` so device
 * connection state renders in the one dot+label shape every list uses.
 */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <Badge tone={TONE[state]} variant="dot" label={LABEL[state]} />;
}
