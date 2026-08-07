import type { components } from "@/types/api";

type ConnectionState = components["schemas"]["DeviceResponse"]["connection_state"];

const CONFIG: Record<ConnectionState, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-status-online", text: "text-status-online" },
  offline: { label: "Offline", dot: "bg-status-offline", text: "text-status-offline" },
  never_connected: { label: "Never connected", dot: "bg-status-unknown", text: "text-ink-muted" },
};

/**
 * Status is never color-alone (UX_UI_Description.md's Accessibility section):
 * every state pairs a dot with a text label, so it reads the same to a
 * color-blind user or a screen reader.
 */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const cfg = CONFIG[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      <span className={cfg.text}>{cfg.label}</span>
    </span>
  );
}
