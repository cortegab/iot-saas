import { AlertCircle } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";

export interface ErrorStateProps {
  /** What failed, in plain words ("Couldn't load devices"). */
  title?: string;
  /** Detail and what the user can do. */
  message: string;
  onRetry?: () => void;
}

/** DESIGN.md §5 ErrorState: states what failed and offers a retry — never a
 * bare "Something went wrong". */
export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-status-error/45 bg-status-error-surface px-[18px] py-4"
    >
      <AlertCircle aria-hidden size={18} className="shrink-0 text-status-error" />
      <div className="min-w-0 flex-[1_1_240px]">
        {title && <p className="text-sm font-semibold text-ink">{title}</p>}
        <p className={title ? "text-sm text-ink-muted" : "text-sm text-status-error"}>{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClassName({ variant: "secondary", size: "sm" })}>
          Retry
        </button>
      )}
    </div>
  );
}
