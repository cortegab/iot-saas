import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type CalloutTone = "info" | "warning";

export interface CalloutProps {
  children: ReactNode;
  /** `info` (default) — ambient help, brass tint. `warning` — a caution the
   * author should read, pending-amber tint. */
  tone?: CalloutTone;
  /** Leading icon. Default on. */
  icon?: boolean;
  className?: string;
}

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-accent bg-accent-muted", icon: "text-accent", Icon: Info },
  warning: {
    box: "border-status-pending bg-status-pending-surface",
    icon: "text-status-pending",
    Icon: AlertTriangle,
  },
};

/** The prototype's `.tip` — a short, left-bordered note tinted with the
 * relevant token. Ambient guidance, not an error: `rounded-md` (never
 * `rounded-xl`, so it doesn't read as a Card), no dismiss, no `role="alert"`. */
export function Callout({ children, tone = "info", icon = true, className }: CalloutProps) {
  const { box, icon: iconColor, Icon } = TONE[tone];
  return (
    <div className={cn("flex gap-2 rounded-md border-l-2 px-3 py-2 text-sm text-ink-muted", box, className)}>
      {icon && <Icon aria-hidden size={16} className={cn("mt-0.5 shrink-0", iconColor)} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
