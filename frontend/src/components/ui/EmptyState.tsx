import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Usually the view's primary action ("Add device"), or "Clear filters". */
  action?: ReactNode;
  icon?: ReactNode;
  /** `sm` for empty panels inside a card. */
  size?: "md" | "sm";
  className?: string;
}

/** DESIGN.md §5 EmptyState: explains why it's empty and offers the primary
 * action — never a bare "No data". Never rendered together with an error. */
export function EmptyState({ title, description, action, icon, size = "md", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface text-center",
        size === "sm" ? "p-[18px]" : "px-5 py-10",
        className,
      )}
    >
      {icon && <div className="text-ink-muted">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="max-w-[52ch] text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
