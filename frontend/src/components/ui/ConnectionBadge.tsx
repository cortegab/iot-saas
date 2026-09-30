import { Badge, type DotShape, type StatusTone } from "@/components/ui/Badge";
import type { components } from "@/types/api";

type ConnectionState = components["schemas"]["DeviceResponse"]["connection_state"];

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
  online: "Online",
  offline: "Offline",
  never_connected: "Never connected",
};

/** Device connection state as a status pill — never colour alone: every state
 * pairs a dot shape with a word. */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <Badge tone={TONE[state]} shape={SHAPE[state]} label={LABEL[state]} />;
}
