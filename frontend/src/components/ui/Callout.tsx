import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type CalloutTone = "info" | "warning" | "error";

export interface CalloutProps {
  children: ReactNode;
  /** `info` (default) — accent-muted tint. `warning` — a risk worth reading,
   * pending-surface tint. `error` — something failed, error-surface tint. */
  tone?: CalloutTone;
  title?: ReactNode;
  /** Leading icon. Default on. */
  icon?: boolean;
  /** Tips only (DESIGN.md §5): renders a dismiss button. */
  onDismiss?: () => void;
  className?: string;
}

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-accent/25 bg-accent-muted", icon: "text-accent", Icon: Info },
  warning: {
    box: "border-status-pending/45 bg-status-pending-surface",
    icon: "text-status-pending",
    Icon: AlertTriangle,
  },
  error: {
    box: "border-status-error/45 bg-status-error-surface",
    icon: "text-status-error",
    Icon: AlertCircle,
  },
};

/** A short tinted note (DESIGN.md §5 Callout). Not a Card: `rounded-md`, and
 * no `role="alert"` — pass a live region yourself if it announces a change. */
export function Callout({ children, tone = "info", title, icon = true, onDismiss, className }: CalloutProps) {
  const { box, icon: iconColor, Icon } = TONE[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-md border px-3.5 py-3 text-sm text-ink", box, className)}>
      {icon && <Icon aria-hidden size={16} className={cn("mt-0.5 shrink-0", iconColor)} />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && "mt-0.5 text-ink-muted")}>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-ink"
        >
          <X aria-hidden size={14} />
        </button>
      )}
    </div>
  );
}
