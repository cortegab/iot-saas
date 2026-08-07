import type { RealtimeStatus } from "@/lib/realtime";

const CONFIG: Record<RealtimeStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: "Connecting…", dot: "bg-status-unknown", text: "text-ink-muted" },
  open: { label: "Live", dot: "bg-status-online", text: "text-status-online" },
  reconnecting: { label: "Reconnecting…", dot: "bg-status-pending", text: "text-status-pending" },
  closed: { label: "Offline", dot: "bg-status-offline", text: "text-status-offline" },
};

/**
 * The browser tab's own connection to the platform — deliberately distinct
 * from a device's ConnectionBadge (UX_UI_Description.md: "Offline — device
 * disconnected vs. browser disconnected, visually distinct from each
 * other"). Same dot+label pairing convention as ConnectionBadge, so status
 * is never color-alone.
 */
export function RealtimeStatusBadge({ status }: { status: RealtimeStatus }) {
  const cfg = CONFIG[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs"
      title="This browser tab's connection to the platform"
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      <span className={cfg.text}>{cfg.label}</span>
    </span>
  );
}
