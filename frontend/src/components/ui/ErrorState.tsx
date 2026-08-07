export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/** States what failed and what the user can do about it
 * (UX_UI_Description.md's Error state requirement) — never a bare "Something
 * went wrong" with no path forward. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-xl border border-status-error/30 bg-status-error/10 p-4"
    >
      <p className="text-sm text-status-error">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface-raised"
        >
          Retry
        </button>
      )}
    </div>
  );
}
