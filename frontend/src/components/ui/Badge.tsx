import { cn } from "@/lib/cn";

export type StatusTone = "online" | "offline" | "unknown" | "pending" | "error";
export type BadgeVariant = "text" | "dot" | "pill" | "indicator";

const TONE_CLASSES: Record<StatusTone, { dot: string; text: string; pillBg: string }> = {
  online: { dot: "bg-status-online", text: "text-status-online", pillBg: "bg-status-online/10" },
  offline: { dot: "bg-status-offline", text: "text-status-offline", pillBg: "bg-status-offline/10" },
  unknown: { dot: "bg-status-unknown", text: "text-ink-muted", pillBg: "bg-status-unknown/10" },
  pending: { dot: "bg-status-pending", text: "text-status-pending", pillBg: "bg-status-pending/10" },
  error: { dot: "bg-status-error", text: "text-status-error", pillBg: "bg-status-error/10" },
};

export interface BadgeProps {
  tone: StatusTone;
  label: string;
  /** `text` — plain colored label. `dot` — colored dot + label (state that
   * needs a name, e.g. connection state). `pill` — filled rounded chip
   * (enabled/disabled, device-link tags). `indicator` — bare dot, no label,
   * for a presence marker next to content that already names itself (e.g. an
   * unread-notification dot beside the message text). Always resolves to a
   * `status-*` token, never `accent` — status color must stay reserved for
   * semantic state (globals.css). */
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ tone, label, variant = "pill", className }: BadgeProps) {
  const cfg = TONE_CLASSES[tone];

  if (variant === "indicator") {
    return <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dot, className)} />;
  }

  if (variant === "text") {
    return <span className={cn("text-sm", cfg.text, className)}>{label}</span>;
  }

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
        <span aria-hidden className={cn("h-2 w-2 rounded-full", cfg.dot)} />
        <span className={cfg.text}>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cfg.pillBg, cfg.text, className)}
    >
      {label}
    </span>
  );
}
