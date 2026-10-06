import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardPadding = "sm" | "md";

const PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-3.5",
  md: "p-5",
};

export interface CardProps {
  children: ReactNode;
  /** `sm` — dense tiles. `md` — standalone content sections. Radius is always
   * `rounded-xl` — only density differs. */
  padding?: CardPadding;
  className?: string;
}

export function Card({ children, padding = "md", className }: CardProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border bg-surface shadow-card",
        PADDING_CLASSES[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A card's heading row: title (15px/600) + optional description, with
 * actions on the right. */
export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13.5px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
