import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardPadding = "sm" | "md";

const PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-4",
};

export interface CardProps {
  children: ReactNode;
  /** `sm` — dense list-row content (settings rows, metric tiles). `md` —
   * standalone content sections (form cards, credential-reveal boxes). Radius
   * stays `rounded-xl` for both — only density differs, so the app doesn't
   * grow a second competing card shape. */
  padding?: CardPadding;
  className?: string;
}

export function Card({ children, padding = "md", className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border border-t-panel-edge bg-surface",
        PADDING_CLASSES[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}
