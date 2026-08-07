import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Always suggests the next action rather than saying "no data"
 * (UX_UI_Description.md's States and Tables sections). */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
